let state = {
	messageIds: [],
	folders: [],
	filteredFolders: [],
	selectedIndex: -1,
	action: "move",
	isExecuting: false,
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

function getPathLeaf(pathValue) {
	let value = (pathValue || "").trim();
	if (!value) {
		return "";
	}
	let segments = value.split("/").filter(Boolean);
	return segments[segments.length - 1] || value;
}

function getMatchScore(folder, normalizedQuery) {
	let name = normalizeSearchText(folder.name || "");
	let path = normalizeSearchText(folder.path || "");
	let pathLeaf = normalizeSearchText(getPathLeaf(folder.path || folder.primaryLabel || ""));
	let account = normalizeSearchText(folder.accountName || "");

	if (pathLeaf == normalizedQuery) {
		return 0;
	}
	if (name == normalizedQuery) {
		return 1;
	}
	if (pathLeaf.startsWith(normalizedQuery)) {
		return 2;
	}
	if (name.startsWith(normalizedQuery)) {
		return 3;
	}
	if (path.startsWith(normalizedQuery)) {
		return 4;
	}
	if (pathLeaf.includes(normalizedQuery)) {
		return 5;
	}
	if (name.includes(normalizedQuery)) {
		return 6;
	}
	if (path.includes(normalizedQuery)) {
		return 7;
	}
	if (account.startsWith(normalizedQuery)) {
		return 20;
	}
	if (account.includes(normalizedQuery)) {
		return 21;
	}

	return Number.POSITIVE_INFINITY;
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

function isExpectedContextUnloadError(error) {
	let message = String(error?.message || error || "").toLowerCase();
	return (
		message.includes("context unloaded") ||
		message.includes("conduits") ||
		message.includes("extension context invalidated") ||
		message.includes("message manager disconnected")
	);
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
		state.filteredFolders = state.folders
			.map(folder => ({
				folder,
				score: getMatchScore(folder, normalizedQuery),
			}))
			.filter(candidate => Number.isFinite(candidate.score))
			.sort((a, b) => {
				if (a.score != b.score) {
					return a.score - b.score;
				}

				let aLabel = a.folder.primaryLabel || a.folder.path || a.folder.name || "";
				let bLabel = b.folder.primaryLabel || b.folder.path || b.folder.name || "";
				let labelCmp = aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
				if (labelCmp != 0) {
					return labelCmp;
				}

				let aAccount = a.folder.accountName || "";
				let bAccount = b.folder.accountName || "";
				return aAccount.localeCompare(bAccount, undefined, { sensitivity: "base" });
			})
			.map(candidate => candidate.folder);
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
	if (state.isExecuting) {
		return;
	}

	if (state.action != "goto" && !state.messageIds.length) {
		setStatus("Select one or more messages first");
		return;
	}

	state.isExecuting = true;
	setStatus(`${getActionLabel()}…`);

	let response;
	try {
		response = await browser.runtime.sendMessage({
			type: "quickmove:execute",
			action: state.action,
			folderId,
			messageIds: state.messageIds,
		});
	} catch (error) {
		if (isExpectedContextUnloadError(error)) {
			return;
		}
		setStatus(String(error?.message || "Action failed"));
		return;
	} finally {
		state.isExecuting = false;
	}

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
