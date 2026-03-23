const PICKER_URL = browser.runtime.getURL("picker/picker.html");
const SELECTION_TTL_MS = 15000;

let pickerWindowId = null;
let selectionContext = {
	messageIds: [],
	sourceWindowId: null,
	sourceTabId: null,
	action: "move",
	capturedAt: 0,
};

function normalizeSearchText(value) {
	return (value || "")
		.toLowerCase()
		.replaceAll("ä", "ae")
		.replaceAll("ö", "oe")
		.replaceAll("ü", "ue")
		.replaceAll("ß", "ss")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

function decodeImapModifiedUtf7(value) {
	if (!value || typeof value != "string") {
		return "";
	}

	return value.replace(/&([A-Za-z0-9+,]*)-/g, (fullMatch, encodedPart) => {
		if (encodedPart === "") {
			return "&";
		}

		try {
			let base64 = encodedPart.replaceAll(",", "/");
			while (base64.length % 4 !== 0) {
				base64 += "=";
			}

			let binary = atob(base64);
			if (binary.length % 2 !== 0) {
				return fullMatch;
			}
			let utf16Units = [];
			for (let i = 0; i < binary.length; i += 2) {
				let highByte = binary.charCodeAt(i);
				let lowByte = binary.charCodeAt(i + 1);
				utf16Units.push((highByte << 8) | lowByte);
			}

			return String.fromCharCode(...utf16Units);
		} catch (_error) {
			return fullMatch;
		}
	});
}

async function collectMessageIdsFromList(messageList) {
	let allIds = [];
	let currentList = messageList;

	while (currentList) {
		for (let message of currentList.messages || []) {
			allIds.push(message.id);
		}

		if (!currentList.id) {
			break;
		}

		currentList = await browser.messages.continueList(currentList.id);
	}

	return allIds;
}

async function getSelectedMessageIdsForTab(tab) {
	if (!tab) {
		return [];
	}

	if (tab.mailTab) {
		let selected = await browser.mailTabs.getSelectedMessages(tab.id);
		return collectMessageIdsFromList(selected);
	}

	if (tab.type == "messageDisplay") {
		let displayed = await browser.messageDisplay.getDisplayedMessage(tab.id);
		return displayed ? [displayed.id] : [];
	}

	return [];
}

async function getSelectedMessageIdsInWindow(windowId) {
	if (windowId === null || windowId === undefined) {
		return [];
	}

	let activeTabs = await browser.tabs.query({ active: true, windowId });
	let activeTab = activeTabs[0] || null;
	let messageIds = await getSelectedMessageIdsForTab(activeTab);
	if (messageIds.length) {
		return messageIds;
	}

	let allTabs = await browser.tabs.query({ windowId });
	for (let tab of allTabs) {
		if (!tab.mailTab && tab.type != "messageDisplay") {
			continue;
		}
		messageIds = await getSelectedMessageIdsForTab(tab);
		if (messageIds.length) {
			return messageIds;
		}
	}

	return [];
}

async function captureSelectionBeforeOpening(action) {
	let focusedWindow = await browser.windows.getLastFocused({ populate: true });
	let activeTab = focusedWindow?.tabs?.find(tab => tab.active) || null;
	let messageIds = await getSelectedMessageIdsForTab(activeTab);

	selectionContext = {
		messageIds,
		sourceWindowId: focusedWindow?.id ?? null,
		sourceTabId: activeTab?.id ?? null,
		action,
		capturedAt: Date.now(),
	};
}

async function getMessageIdsForPicker() {
	let isFreshSelection = Date.now() - selectionContext.capturedAt <= SELECTION_TTL_MS;
	if (isFreshSelection && selectionContext.messageIds.length) {
		return [...selectionContext.messageIds];
	}

	let fromSourceWindow = await getSelectedMessageIdsInWindow(selectionContext.sourceWindowId);
	if (fromSourceWindow.length) {
		return fromSourceWindow;
	}

	let focusedWindow = await browser.windows.getLastFocused();
	return getSelectedMessageIdsInWindow(focusedWindow?.id ?? null);
}

async function getFoldersForPicker() {
	let [folders, accounts, prefs] = await Promise.all([
		browser.folders.query({ canAddMessages: true }),
		browser.accounts.list(),
		browser.storage.local.get({ excludeArchives: false }),
	]);

	let accountNameById = new Map(accounts.map(account => [account.id, account.name]));
	let excludeArchives = prefs.excludeArchives;

	let candidateFolders = (folders || [])
		.filter(folder => {
			if (!excludeArchives) {
				return true;
			}
			return !Array.isArray(folder.specialUse) || !folder.specialUse.includes("archives");
		});

	let duplicatePathCounts = new Map();
	for (let folder of candidateFolders) {
		let decodedPath = decodeImapModifiedUtf7(folder.path || "");
		let decodedName = decodeImapModifiedUtf7(folder.name || "");
		let pathKey = (decodedPath || decodedName).toLowerCase();
		duplicatePathCounts.set(pathKey, (duplicatePathCounts.get(pathKey) || 0) + 1);
	}

	return candidateFolders
		.map(folder => {
			let accountName = accountNameById.get(folder.accountId) || "";
			let decodedName = decodeImapModifiedUtf7(folder.name || "");
			let decodedPath = decodeImapModifiedUtf7(folder.path || "");
			let pathLabel = decodedPath || decodedName;
			let pathKey = pathLabel.toLowerCase();
			let showAccount = (duplicatePathCounts.get(pathKey) || 0) > 1;
			let primaryLabel = pathLabel;
			let secondaryLabel = showAccount && accountName ? accountName : "";
			let rawSearch = `${decodedName} ${decodedPath} ${accountName}`;
			let normalizedSearch = normalizeSearchText(rawSearch);
			return {
				id: folder.id,
				accountId: folder.accountId,
				name: decodedName,
				path: decodedPath,
				accountName,
				primaryLabel,
				secondaryLabel,
				searchText: `${rawSearch.toLowerCase()} ${normalizedSearch}`,
			};
		})
		.sort((a, b) => {
			let primaryCmp = a.primaryLabel.localeCompare(b.primaryLabel, undefined, {
				sensitivity: "base",
			});
			if (primaryCmp != 0) {
				return primaryCmp;
			}
			return a.accountName.localeCompare(b.accountName, undefined, { sensitivity: "base" });
		});
}

async function findFolderById(folderId) {
	let folders = await browser.folders.query({ canAddMessages: true });
	return (folders || []).find(folder => folder.id == folderId) || null;
}

async function getTargetMailTab() {
	if (selectionContext.sourceTabId !== null) {
		try {
			let sourceTab = await browser.tabs.get(selectionContext.sourceTabId);
			if (sourceTab?.mailTab) {
				return sourceTab;
			}
		} catch (_error) {
		}
	}

	if (selectionContext.sourceWindowId !== null) {
		let tabs = await browser.tabs.query({ windowId: selectionContext.sourceWindowId });
		let tab = tabs.find(candidate => candidate.mailTab);
		if (tab) {
			return tab;
		}
	}

	let allTabs = await browser.tabs.query({});
	return allTabs.find(candidate => candidate.mailTab) || null;
}

async function gotoFolder(folderId) {
	let destination = await findFolderById(folderId);
	if (!destination) {
		return { ok: false, error: "Destination folder not found" };
	}

	let targetTab = await getTargetMailTab();
	if (!targetTab) {
		return { ok: false, error: "No mail tab available" };
	}

	await browser.mailTabs.update(targetTab.id, { displayedFolder: destination });
	try {
		await browser.windows.update(targetTab.windowId, { focused: true });
	} catch (_error) {
	}

	return { ok: true };
}

async function openPickerWindow() {
	if (pickerWindowId !== null) {
		try {
			await browser.windows.update(pickerWindowId, { focused: true });
			return;
		} catch (_error) {
			pickerWindowId = null;
		}
	}

	let pickerWindow = await browser.windows.create({
		url: PICKER_URL,
		type: "popup",
		width: 420,
		height: 560,
	});

	pickerWindowId = pickerWindow.id;
}

browser.commands.onCommand.addListener(async command => {
	let actionByCommand = {
		"open-quick-move": "move",
		"open-quick-move-secondary": "copy",
		"open-quick-move-tertiary": "goto",
	};

	let action = actionByCommand[command];
	if (action) {
		await captureSelectionBeforeOpening(action);
		await openPickerWindow();
	}
});

browser.windows.onRemoved.addListener(windowId => {
	if (windowId == pickerWindowId) {
		pickerWindowId = null;
	}
});

browser.runtime.onMessage.addListener(message => {
	if (message?.type == "quickmove:get-data") {
		return Promise.all([getMessageIdsForPicker(), getFoldersForPicker()]).then(
			([messageIds, folders]) => ({
				messageIds,
				folders,
				action: selectionContext.action || "move",
			})
		);
	}

	if (message?.type == "quickmove:execute") {
		return (async () => {
			let action = message.action || selectionContext.action || "move";
			if (!message.folderId) {
				return { ok: false, error: "No destination folder selected" };
			}

			if (action == "goto") {
				return gotoFolder(message.folderId);
			}

			if (!Array.isArray(message.messageIds) || !message.messageIds.length) {
				return { ok: false, error: "No messages selected" };
			}

			let destination = await findFolderById(message.folderId);
			if (!destination) {
				return { ok: false, error: "Destination folder not found" };
			}

			if (action == "copy") {
				await browser.messages.copy(message.messageIds, message.folderId);
				return { ok: true };
			}

			await browser.messages.move(message.messageIds, message.folderId);

			return { ok: true };
		})();
	}

	return undefined;
});
