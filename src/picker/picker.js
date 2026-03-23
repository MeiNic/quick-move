let state = {
	messageIds: [],
	folders: [],
	filteredFolders: [],
	selectedIndex: -1,
	action: "move",
};

const folderSearch = document.getElementById("folderSearch");
const folderList = document.getElementById("folderList");
const statusNode = document.getElementById("status");

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

function setStatus(text) {
	statusNode.textContent = text;
}

function getActionLabel() {
	if (state.action == "copy") {
		return "Copy";
	}
	if (state.action == "goto") {
		return "Go to";
	}
	return "Move";
}

function renderFolders() {
	folderList.textContent = "";

	if (!state.filteredFolders.length) {
		let emptyItem = document.createElement("li");
		emptyItem.className = "empty";
		emptyItem.textContent = "No matching folders";
		folderList.appendChild(emptyItem);
		return;
	}

	for (let [folderIndex, folder] of state.filteredFolders.entries()) {
		let li = document.createElement("li");
		let button = document.createElement("button");
		button.type = "button";
		button.className = "folder-button";

		let titleNode = document.createElement("span");
		titleNode.className = "folder-title";
		titleNode.textContent = folder.primaryLabel || folder.path || folder.name || "";
		button.appendChild(titleNode);

		if (folder.secondaryLabel) {
			let metaNode = document.createElement("span");
			metaNode.className = "folder-meta";
			metaNode.textContent = folder.secondaryLabel;
			button.appendChild(metaNode);
		}

		if (folderIndex == state.selectedIndex) {
			button.classList.add("selected");
			button.setAttribute("aria-selected", "true");
		} else {
			button.setAttribute("aria-selected", "false");
		}
		button.dataset.folderId = folder.id;
		button.addEventListener("click", () => {
			void executeAction(folder.id);
		});
		li.appendChild(button);
		folderList.appendChild(li);
	}
}

function applyFilter() {
	let query = folderSearch.value.trim();
	let normalizedQuery = normalizeSearchText(query);
	if (!query) {
		state.filteredFolders = [...state.folders];
	} else {
		state.filteredFolders = state.folders.filter(folder =>
			folder.searchText.includes(normalizedQuery)
		);
	}

	state.selectedIndex = state.filteredFolders.length ? 0 : -1;

	renderFolders();
}

function updateSelectedIndex(delta) {
	if (!state.filteredFolders.length) {
		state.selectedIndex = -1;
		return;
	}

	if (state.selectedIndex < 0) {
		state.selectedIndex = 0;
	} else {
		let length = state.filteredFolders.length;
		state.selectedIndex = (state.selectedIndex + delta + length) % length;
	}

	renderFolders();
	let selectedButton = folderList.querySelector(".folder-button.selected");
	selectedButton?.scrollIntoView({ block: "nearest" });
}

async function executeAction(folderId) {
	if (state.action != "goto" && !state.messageIds.length) {
		setStatus("Select one or more messages first");
		return;
	}

	setStatus(`${getActionLabel()}…`);

	let response = await browser.runtime.sendMessage({
		type: "quickmove:execute",
		action: state.action,
		folderId,
		messageIds: state.messageIds,
	});

	if (!response?.ok) {
		setStatus(response?.error || "Move failed");
		return;
	}

	window.close();
}

function onSearchKeyDown(event) {
	if (event.key == "Escape") {
		event.preventDefault();
		window.close();
		return;
	}

	if (event.key == "ArrowDown") {
		event.preventDefault();
		updateSelectedIndex(1);
		return;
	}

	if (event.key == "ArrowUp") {
		event.preventDefault();
		updateSelectedIndex(-1);
		return;
	}

	if (event.key != "Enter") {
		return;
	}

	event.preventDefault();
	let selectedFolder = state.filteredFolders[state.selectedIndex] || state.filteredFolders[0];
	if (selectedFolder) {
		void executeAction(selectedFolder.id);
	}
}

async function init() {
	let data = await browser.runtime.sendMessage({ type: "quickmove:get-data" });

	state.messageIds = Array.isArray(data?.messageIds) ? data.messageIds : [];
	state.folders = Array.isArray(data?.folders) ? data.folders : [];
	state.filteredFolders = [...state.folders];
	state.selectedIndex = state.filteredFolders.length ? 0 : -1;
	state.action = data?.action || "move";
	document.title = `Quick Folder ${getActionLabel()}`;

	if (state.action != "goto" && !state.messageIds.length) {
		setStatus("Select one or more messages first");
	} else {
		setStatus("");
	}

	renderFolders();
	folderSearch.focus();
}

folderSearch.addEventListener("input", applyFilter);
folderSearch.addEventListener("keydown", onSearchKeyDown);

void init();
