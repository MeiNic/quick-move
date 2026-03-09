/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2009-2019 */

/* global Services, GetMessagePaneFrame, MailServices, goDoCommand */

"use strict";

var quickmove = (function() {
  const ADDON_ID = "qfm-classic@betterbird.eu";

  let { MultiSuffixTree } = ChromeUtils.importESModule("resource:///modules/gloda/SuffixTree.sys.mjs");
  let { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");

  let Quickmove = {
    getWXAPI(name, sync = false) {
      function implementation(api) {
        let impl = api.getAPI({ extension })[name];

        if (name == "storage") {
          impl.local.get = (...args) => impl.local.callMethodInParentProcess("get", args);
          impl.local.set = (...args) => impl.local.callMethodInParentProcess("set", args);
          impl.local.remove = (...args) => impl.local.callMethodInParentProcess("remove", args);
          impl.local.clear = (...args) => impl.local.callMethodInParentProcess("clear", args);
        }
        return impl;
      }

      let extension = ExtensionParent.GlobalManager.getExtension(ADDON_ID);
      if (sync) {
        let api = extension.apiManager.getAPI(name, extension, "addon_parent");
        return implementation(api);
      } else {
        return extension.apiManager.asyncGetAPI(name, extension, "addon_parent").then(api => {
          return implementation(api);
        });
      }
    },

    getString: function(aName) {
      return this.getWXAPI("i18n", true).getMessage(aName);
    },

    getFullName: function(aFolder) {
      let folder = aFolder;
      let fullPath = [];

      while (folder && folder.parent) {
        fullPath.unshift(folder.prettyName);
        folder = folder.parent;
      }

      return fullPath.join("/");
    },

    /**
     * Clear all items except the menuseparator and the search box
     */
    clearItems: function(popup) {
      while (popup.lastChild.className != "quickmove-separator") {
        popup.removeChild(popup.lastChild);
      }
    },

    getPref: async function(name, defaultValue = null) {
      let storage = await this.getWXAPI("storage");
      let prefs = await storage.local.get({ [name]: defaultValue });

      return prefs[name];
    },

    migrateStorage: async function() {
      let storage = await this.getWXAPI("storage");

      await storage.local.set({
        maxRecentFolders: Services.prefs.getIntPref("extensions.quickmove.maxRecentFolders", 15),
        markAsRead: Services.prefs.getBoolPref("extensions.quickmove.markAsRead", true),
        excludeArchives: Services.prefs.getBoolPref("extensions.quickmove.excludeArchives", false),
      });

      Services.prefs.clearUserPref("extensions.quickmove.maxRecentFolders");
      Services.prefs.clearUserPref("extensions.quickmove.markAsRead");
      Services.prefs.clearUserPref("extensions.quickmove.excludeArchives");
    },

    debounce: function(func, wait, immediate) {
      // https://davidwalsh.name/javascript-debounce-function (MIT license from underscore)
      // Some adaptions to be more ES6-like and satisfy eslint
      let timeout;
      return function(...args) {
        let callNow = immediate && !timeout;
        clearTimeout(timeout);

        timeout = setTimeout(() => {
          timeout = null;
          if (!immediate) {
            func.apply(this, args);
          }
        }, wait);

        if (callNow) {
          func.apply(this, args);
        }
      };
      // End MIT license code
    },

    createXULElement: function(doc, tagName) {
      // createXULElement was removed in TB 141; fall back to the XUL namespace.
      if (doc.createXULElement) {
        return doc.createXULElement(tagName);
      }
      return doc.createElementNS(
        "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
        tagName
      );
    },

    /**
     * Find the native nsIMsgFolder for a pseudo-folder built from the WX API.
     * Matches by server display name and folder path.
     */
    findNativeFolder: function(pseudoFolder) {
      try {
        let parts = pseudoFolder.path.split("/").filter(Boolean);
        for (let acct of MailServices.accounts.accounts) {
          let server = acct.incomingServer;
          if (!server) { continue; }
          if (server.prettyName !== pseudoFolder.server?.prettyName) { continue; }
          let f = server.rootFolder;
          for (let part of parts) {
            f = f.getChildNamed(part);
            if (!f) { break; }
          }
          if (f) { return f; }
        }
      } catch (ex) {
        console.error("QFM: findNativeFolder failed", ex);
      }
      return null;
    },
  };

  return {
    /** Cleanup functions for this window **/
    cleanup: [],

    /** An array of recent folders, to be shown when no search term is entered */
    recentFolders: [],

    /** A gloda suffix tree to provide quick search access to the folders */
    suffixTree: null,

    /** True when something was typed but the search has not completed */
    dirty: false,

    /** Function to call when the seach completes. Used by the dirty logic */
    searchCompleteFunc: null,

    /** Element last focused when the popup was initiated */
    initiator: null,

    /**
     * Selected message headers (nsIMsgDBHdr[]), captured synchronously in
     * popupshowing from gDBView before the popup can steal focus.
     */
    pendingMessages: [],

    /**
     * Event listener method to be called when the 'move to' or 'copy to'
     * context menu is shown.
     */
    popupshowing: function(event, useDocument = false) {
      if (event.target.getAttribute("ignorekeys") != "true") {
        // If we are showing the menuitems, then don't set up the folders but
        // keep the old list.
        return;
      }

      let focusedElement = document.commandDispatcher.focusedElement;
      if (focusedElement && focusedElement.id) {
        quickmove.initiator = document.commandDispatcher.focusedElement;
      }

      // Grab selected message headers right now, synchronously, while we still
      // have a valid window context. The popup will steal focus immediately after.
      try {
        let tabmail = document.getElementById("tabmail");
        let gDBView = tabmail?.currentAbout3Pane?.gDBView;
        quickmove.pendingMessages = gDBView?.getSelectedMsgHdrs() || [];
      } catch (ex) {
        quickmove.pendingMessages = [];
      }

      Quickmove.clearItems(event.target);
      quickmove.prepareFolders().then(() => {
        let initialText = "";
        if (typeof GetMessagePaneFrame != "undefined") {
          let selection = GetMessagePaneFrame().getSelection() || "";
          initialText = selection.toString() || "";
        }

        event.target.firstChild.value = initialText;
        quickmove.dirty = false;
        if (initialText) {
          quickmove.search(event.target.firstChild, useDocument);
        } else {
          quickmove.addFolders(
            quickmove.recentFolders,
            event.target,
            event.target.firstChild.value,
            useDocument
          );
        }
      });
      event.stopPropagation();
    },

    popupshown: function(event) {
      // focus the textbox
      event.target.setAttribute("ignorekeys", "true");
      event.target.firstChild.focus();
    },

    /**
     * Add a set of folders to the context menu.
     *
     * @param folders     An array of folders to add
     * @param popup       The popup to add to
     * @param targetValue The searched text
     */
    addFolders: async function(folders, popup, targetValue, useDocument) {
      let dupeMap = {};
      let serverMap = {};
      let fullPathMap = {};
      let alwaysShowFullPath = await Quickmove.getPref("alwaysShowFullPath", false);
      let alwaysShowMailbox = await Quickmove.getPref("alwaysShowMailbox", false);
      let doNotCrop = await Quickmove.getPref("doNotCrop", false);

      // First create a map of pretty names to find possible duplicates.
      for (let folder of folders) {
        let lowerName = folder.prettyName.toLowerCase();
        let serverLowerName = (folder.server?.prettyName || "").toLowerCase();

        if (!(lowerName in serverMap)) {
          serverMap[lowerName] = {};
        }

        if (!(lowerName in dupeMap)) {
          dupeMap[lowerName] = 0;
          serverMap[lowerName][serverLowerName] = 0;
        }

        if (
          lowerName in serverMap &&
          serverLowerName in serverMap[lowerName] &&
          serverMap[lowerName][serverLowerName]
        ) {
          // Already in the server map, this folder needs the full path
          fullPathMap[lowerName] = true;
        }

        serverMap[lowerName][serverLowerName] = true;
        dupeMap[lowerName]++;
      }

      // Now add each folder, appending the server name if the folder name
      // itself would appear more than once.
      let doc;
      if (useDocument) {
        doc = document;
      } else {
        let tabmail = window.top.document.getElementById("tabmail");
        if (tabmail) {
          doc = tabmail.currentAbout3Pane?.document;
        } else {
          // No support for stand-alone windows since rendering the menu there results in
          // TypeError: el.render is not a function - chrome://global/content/elements/menu.js:165
          // which is Mozilla platform code.
          doc = document;
        }
      }
      for (let folder of folders) {
        let node = Quickmove.createXULElement(doc, "menuitem");
        if (doNotCrop) {
          node.setAttribute("crop", "none");
        }
        let label = folder.prettyName;
        let lowerLabel = label.toLowerCase();

        if (lowerLabel in fullPathMap || alwaysShowFullPath) {
          label = Quickmove.getFullName(folder);
        }

        if ((lowerLabel in dupeMap && dupeMap[lowerLabel] > 1) || alwaysShowMailbox) {
          label += " - " + (folder.server?.prettyName || "");
        }
        node.setAttribute("label", label);
        node._folder = folder;

        node.setAttribute("class", "folderMenuItem menuitem-iconic");
        if (lowerLabel == targetValue.toLowerCase()) {
          // An exact match, put this at the top after the separator
          let separator = popup.getElementsByClassName("quickmove-separator")[0];
          popup.insertBefore(node, separator.nextSibling);
        } else {
          // Otherwise append to the end
          popup.appendChild(node);
        }
      }
    },

    /**
     * Prepare the recent folders and the suffix tree with all available folders.
     */
    prepareFolders: async function() {
      let maxRecent = await Quickmove.getPref("maxRecentFolders", 15);
      let excludeArchives = await Quickmove.getPref("excludeArchives", false);

      let allFolders = [];
      let allNames = [];
      let recentFolders = (quickmove.recentFolders = []);

      try {
        let foldersApi = await Quickmove.getWXAPI("folders");
        let accountsApi = await Quickmove.getWXAPI("accounts");

        // Build account id → display name map.
        let accountList = await accountsApi.list();
        let accountMap = new Map();
        for (let acct of (accountList || [])) {
          accountMap.set(acct.id, acct.name || acct.label || acct.type || "");
        }

        // Fetch all folders that can receive messages.
        let apiFolders = await foldersApi.query({ canAddMessages: true });
        let folderById = new Map();
        for (let f of (apiFolders || [])) {
          if (!f.name) { continue; }
          if (excludeArchives && Array.isArray(f.specialUse) && f.specialUse.includes("archives")) { continue; }
          let pseudoFolder = {
            prettyName: f.name,
            path: f.path,
            canFileMessages: true,
            server: { prettyName: accountMap.get(f.accountId) || "" },
            _folderId: f.id,
          };
          allFolders.push(pseudoFolder);
          allNames.push(f.name.toLowerCase());
          if (f.id) { folderById.set(f.id, pseudoFolder); }
        }

        // Fetch recent folders sorted by last-used-as-destination.
        let recentApiFolders = await foldersApi.query({
          canAddMessages: true,
          sort: "lastUsedAsDestination",
          limit: maxRecent,
        });
        for (let f of (recentApiFolders || [])) {
          if (!f.name) { continue; }
          if (excludeArchives && Array.isArray(f.specialUse) && f.specialUse.includes("archives")) { continue; }
          recentFolders.push(folderById.get(f.id) || {
            prettyName: f.name,
            path: f.path,
            canFileMessages: true,
            server: { prettyName: accountMap.get(f.accountId) || "" },
            _folderId: f.id,
          });
        }
      } catch (ex) {
        console.error("QFM: prepareFolders failed", ex);
      }

      quickmove.suffixTree = new MultiSuffixTree(allNames, allFolders);
    },


    /**
     * Perform a search. If no search term is entered, the recent folders are
     * shown, otherwise folders which match the search term are shown.
     */
    search: function(textboxNode, useDocument) {
      let popup = textboxNode.parentNode;
      Quickmove.clearItems(popup);
      if (!quickmove.suffixTree) {
        return;
      }
      if (textboxNode.value.length) {
        let folders = quickmove.suffixTree
          .findMatches(textboxNode.value.toLowerCase())
          .filter(x => x.canFileMessages);
        if (folders.length) {
          quickmove.addFolders(folders, popup, textboxNode.value, useDocument);
        } else {
          let node = Quickmove.createXULElement(document, "menuitem");
          node.setAttribute("disabled", "true");
          node.style.textAlign = "center";
          node.setAttribute("label", Quickmove.getString("noResults"));
          popup.appendChild(node);
        }
      } else {
        quickmove.addFolders(quickmove.recentFolders, popup, textboxNode.value, useDocument);
      }

      // The search is done, reset the dirty count and call the search complete
      // func if it is defined.
      quickmove.dirty = false;
      if (quickmove.searchCompleteFunc) {
        quickmove.searchCompleteFunc();
        quickmove.searchCompleteFunc = null;
      }
    },

    searchDelayed: Quickmove.debounce((textboxNode, useDocument = false) => {
      quickmove.search(textboxNode, useDocument);
    }, 500),

    executeCopy: function(folder) {
      quickmove.executeMove(folder, true);
    },

    executeMove: function(folder, copyNotMove) {
      let messages = quickmove.pendingMessages;
      if (!messages.length) {
        console.error("QFM: executeMove - no messages selected");
        return;
      }
      let dstFolder = Quickmove.findNativeFolder(folder);
      if (!dstFolder) {
        console.error("QFM: executeMove - destination folder not found:", folder.path);
        return;
      }
      let srcFolder = messages[0].folder;
      // TB 141+: pass a plain JS array directly; nsIMutableArray no longer works.
      MailServices.copy.copyMessages(srcFolder, messages, dstFolder, !copyNotMove, null, null, true);
    },

    executeGoto: function(folder) {
      let dstFolder = Quickmove.findNativeFolder(folder);
      if (!dstFolder) {
        console.error("QFM: executeGoto - folder not found:", folder.path);
        return;
      }
      let tabmail = document.getElementById("tabmail");
      tabmail?.currentAbout3Pane?.displayFolder(dstFolder);
    },

    focus: function(event) {
      let popup = event.target.parentNode;
      popup.setAttribute("ignorekeys", "true");
    },

    keypress: function(event, executeFunc) {
      let popup = event.target.parentNode;

      // Executor function used later to execute the actual action
      function executor() {
        let firstFolder =
          event.target.nextSibling &&
          event.target.nextSibling.nextSibling &&
          event.target.nextSibling.nextSibling._folder;
        if (firstFolder) {
          executeFunc(firstFolder);
        }
      }

      // Now check which key was pressed
      if (event.keyCode == event.DOM_VK_ESCAPE) {
        // On escape, cancel and close the popup.
        quickmove.hide(popup);
      } else if (event.keyCode == event.DOM_VK_RETURN) {
        // If the user presses enter, execute the passed action, either directly
        // or indirectly
        if (quickmove.dirty) {
          // We haven't finished searching for folders, wait until the search
          // completes and then move.
          quickmove.searchCompleteFunc = executor;
        } else {
          // Otherwise go ahead and do so directly.
          executor();
        }

        // Now hide the popup
        quickmove.hide(popup);
      } else if (event.keyCode == event.DOM_VK_DOWN && !popup.lastChild.disabled) {
        popup.removeAttribute("ignorekeys");
        popup.firstChild.blur();
      } else {
        // If something was typed, then remember that we haven't searched yet.
        quickmove.dirty = true;

        // Don't stop propagation for normal keypresses.
        return;
      }
      event.stopPropagation();
      event.preventDefault();
    },

    command: function(event, executeFunc, isContext = false) {
      let popup = event.target.parentNode;
      executeFunc(event.target._folder);
      event.stopPropagation();
      quickmove.hide(popup, isContext);
    },

    openPopup: function(popupName, preferFolderTree = false) {
      // The desired behaviour (as for TB/BB 102) is this:
      // Shift+M/Y open over the thread pane or the stand-alone message.
      // Shift+G open over the folder tree.
      let tabmail = document.getElementById("tabmail");
      let currentAbout3Pane = tabmail?.currentAbout3Pane;
      let currentAboutMessage = tabmail?.currentAboutMessage;
      let threadTree = currentAbout3Pane?.threadTree;
      let doc =
        currentAboutMessage?.document || document.getElementById("messageBrowser")?.contentDocument;
      let messagepane = doc?.getElementById("messagepane");
      let folderTree = currentAbout3Pane?.document.getElementById("folderTree");
      // console.log(currentAbout3Pane, currentAboutMessage, threadTree, messagepane, folderTree);
      if (!preferFolderTree && threadTree) {
        // If there is a thread tree (i.e mail 3pane), then use it.
        let selection = threadTree.view.selection;
        let height = threadTree.querySelector("#threadTree-row0")?.clientHeight || 0;
        let headerHeight = threadTree.querySelector(".tree-table-header").clientHeight;
        let rowOffset =
          height * (selection.currentIndex - threadTree.getFirstVisibleIndex() + 1) + headerHeight;
        let popup = document.getElementById(popupName);
        popup.openPopup(threadTree, "overlap", headerHeight, rowOffset);
      } else if (!preferFolderTree && messagepane) {
        let popup = document.getElementById(popupName);
        popup.openPopup(messagepane, "overlap");
      } else if (folderTree) {
        let popup = document.getElementById(popupName);
        popup.openPopup(folderTree, "overlap");
      } else {
        console.error("Couldn't find a node to open the panel on");
      }
    },

    openMove: function() {
      this.openPopup("quickmove-move-menupopup");
    },

    openGoto: function() {
      // There is a folder location popup, open its popup.
      let menupopup = document.getElementById("toolbarFolderLocationPopup");
      if (menupopup) {
        let toolbar = document.getElementById("unifiedToolbarContent");
        let folderLocation = toolbar?.querySelector(".folder-location");
        if (folderLocation) {
          menupopup.openPopup(folderLocation, "after_start");
          return;
        }
      }
      this.openPopup("toolbarFolderLocationPopup", true);
    },

    openCopy: function() {
      this.openPopup("quickmove-copy-menupopup");
    },

    hide: function(popup, isContext = false) {
      if (!isContext) {
        popup.hidePopup();
      }

      // Hiding the menupopup should clear the search text and reset ignorekeys
      // to be able to use the textbox.
      popup.firstChild.value = "";
      popup.setAttribute("ignorekeys", "true");

      // Now reference the previous node, so the user can continue filing or
      // searching
      if (quickmove.initiator) {
        quickmove.initiator.focus();
        quickmove.initiator = null;
      }
    },
  };
})();
