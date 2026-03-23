Quick Folder Move
=================

This add-on provides fast keyboard-driven message moving for Thunderbird.

Current behavior (Thunderbird 140+):

* **Ctrl+Shift+1** (macOS: **Command+Shift+1**) opens the popup in **Move** mode.
* **Ctrl+Shift+2** (macOS: **Command+Shift+2**) opens the popup in **Copy** mode.
* **Ctrl+Shift+3** (macOS: **Command+Shift+3**) opens the popup in **Go to folder** mode.
* The popup shows a search field and all folders that can receive messages.
* Typing filters the list of folders.
* Clicking a folder (or pressing **Enter**) executes the mode-specific action.
* After action execution, the popup closes automatically.

Commands:

* `open-quick-move` (default: **Ctrl+Shift+1**, macOS: **Command+Shift+1**): Move selected messages to the chosen folder.
* `open-quick-move-secondary` (default: **Ctrl+Shift+2**, macOS: **Command+Shift+2**): Copy selected messages to the chosen folder.
* `open-quick-move-tertiary` (default: **Ctrl+Shift+3**, macOS: **Command+Shift+3**): Jump to the chosen folder without moving messages.

Implementation notes:

* Uses only official Thunderbird MailExtension APIs.
* Does not rely on Experiment APIs.
* Intended to be compatible with Mozilla signing requirements.

Source code submission / reviewer notes
--------------------------------------

This add-on source is plain JavaScript/HTML/CSS.

Tooling declaration:

* No code minifier or obfuscator is used.
* No bundler (for example webpack/rollup/parcel) is used.
* No template engine is used.
* No transpilation is used.
* Packaged add-on files are direct source files from `src/` zipped into an XPI.

Build environment requirements:

* OS: Linux, macOS, or Windows.
* Required tool for packaging: `zip` CLI.
* Optional dev tools: Node.js + npm (only for lint/dev scripts in `package.json`, not required for packaging).

Exact build steps (reproducible package):

1. Start in repository root.
2. Ensure `dist/` exists.
3. Create the XPI by zipping the contents of `src/`.

Linux/macOS example:

```bash
mkdir -p dist
rm -f dist/quickmove.xpi
(cd src && zip -9r ../dist/quickmove.xpi *)
```

Windows PowerShell example (with `zip` available, e.g. Git Bash/MSYS):

```powershell
mkdir dist -ErrorAction SilentlyContinue
rm dist/quickmove.xpi -ErrorAction SilentlyContinue
cd src
zip -9r ../dist/quickmove.xpi *
cd ..
```

NPM build script equivalent:

```bash
npm run build
```

Notes for reviewers:

* The generated `dist/quickmove.xpi` is a direct archive of `src/` files.
* There are no machine-generated/transpiled source files in `src/`.
