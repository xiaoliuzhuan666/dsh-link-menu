# dsh-link-menu

A right-click menu for links in the DeepSeek Harness chat, with **accurate
workspace-relative path resolution**.

Right-click a file reference in a chat message and get:

| Item | What it does |
|---|---|
| **Reveal in Finder** / 在 Finder 中显示 | Selects the file in Finder (`explorer /select` on Windows) |
| **Copy File Path** / 复制文件路径 | Copies the absolute path |
| **Open in Browser** / 在浏览器中打开 | Sends an `http(s)` link to the system browser |
| **Copy Link Address** / 复制链接地址 | Copies the URL |

Left-clicking an `http(s)` link also opens the system browser — DSH's desktop
window currently denies every `window.open` with no error.

---

## Read this first: it is a patch set, not a plain plugin

There are already plugins that add a context menu to chat links, and most of
them install with one command. **This one does not**, and the reason matters.

DSH renders a file reference as `<button>`, never `<a href>`. Chromium only
fills `params.linkURL` for real anchors, so the Electron main process sees an
empty URL on every file mention. The path lives in a React closure and never
reaches the DOM.

Two ways out:

| Approach | Cost | Accuracy |
|---|---|---|
| Read `title` / `aria-label` / link text, then guess the workspace | none — pure plugin | relative paths resolve against `process.cwd()` or a hardcoded default workspace, so they are **wrong** in a multi-workspace session |
| Have the renderer stamp the resolved absolute path | three small patches to the app bundle | exact — `cwd` comes from the session itself |

This project takes the second route. That is the whole trade: **three patches
for correct paths.**

If you only ever work in one workspace, a pure plugin is the better choice and
you should use one. If you switch between projects — the case DSH is built for —
relative paths guessed against the wrong root are worse than no feature.

## What it changes

```
/Applications/DeepSeek Harness.app/Contents/Resources/
├── app/lib/main.js                              # let window.open reach the OS browser
├── app/dsh/node_modules/@deepseek-ai/
│   ├── dsh-client-ui-chat/lib/client.js         # pass the session cwd to markdown
│   └── dsh-web-frontend/dist/assets/index-*.js  # stamp data-dsh-file-abs on link buttons
```

plus one client plugin at
`~/.dsh/profiles/<profile>/node_modules/dsh-link-menu/`.

Why each is load-bearing is documented at the top of `scripts/setup.sh`.

## Install

```bash
git clone https://github.com/xiaoliuzhuan666/dsh-link-menu.git
cd dsh-link-menu

bash scripts/setup.sh --status     # what is already applied
bash scripts/setup.sh              # apply everything
```

Then **fully quit DSH (`Cmd+Q`) and reopen**. A page refresh is not enough —
the main-process change needs a new process, and the bundle is cached.

Verify in DevTools (`Option+Cmd+I`):

```js
document.documentElement.getAttribute('data-dsh-link-menu')   // "active"
```

`null` means the client half did not load: check `--status`, and confirm the
plugin name is in `~/.dsh/profiles/<profile>/package.json` →
`dsh.profile.bundles`.

## Undo

```bash
bash scripts/setup.sh --revert
```

Restores the three files from `*.dshbak` backups. The plugin directory is left
in place; remove it and drop `dsh-link-menu` from `dsh.profile.bundles` to
uninstall completely.

Every edit is backed up on first apply and the script is idempotent: running it
twice reports `already patched` and leaves the bytes untouched.

## After a DSH update

App updates overwrite `main.js` and the frontend bundle, so the menu disappears.
Re-run `bash scripts/setup.sh` — it re-derives the bundle filename from
`index.html` and re-applies. If an anchor no longer exists, it stops with
`anchor not found` instead of writing a half-patch; that message means DSH
changed its internals and the anchor needs re-deriving from the live file.

## Requirements

- macOS 13+ or Windows 10+ (Windows is untested — see below)
- DeepSeek Harness desktop `0.2.1-rc.5` — anchors were derived from this build
- No build step, no npm install

## Known limitations

- **Patches break on app updates.** By design; re-run the script.
- **The app's code signature is invalidated** by editing bundle files.
  `codesign --verify` reports `a sealed resource is missing or invalid`. An
  already-installed app keeps launching; a copy of the modified bundle may be
  refused by Gatekeeper on another machine.
- **Windows is untested.** The reveal call goes through the Host Remote
  (`session.openWorkspacePath`), which dispatches to `explorer /select` on
  Windows, and the menu itself is plain DOM. It should work; nobody has run it.
- **The menu is not a native menu.** It is a `position: fixed` element styled to
  match the app, not `Menu.buildFromTemplate`. Native menus are only reachable
  from the Electron main process, which cannot read a file-mention path.

## Why not publish this to the plugin market

DSH's plugin market has no central registry: `dsh-plugin-market`'s `indexes`
config is an array of URLs the user supplies. "Publishing" means hosting a JSON
index. More importantly, a market-installed plugin cannot modify app files, so a
patch set cannot be distributed that way at all.

The upstream discussion asking for a proper seam is
[deepseek-ai/deepseek-harness#11933](https://github.com/deepseek-ai/deepseek-harness/discussions/11933).
If it lands, this project can collapse into a normal plugin and the patches go
away.

## Alternatives

| Project | Notes |
|---|---|
| [dengsixue-stack/dsh-file-context-menu](https://github.com/dengsixue-stack/dsh-file-context-menu) | Pure plugin, no patches. Richer menu (Open With, Save As). Guesses relative paths. |
| [sulfide2085/dsh-custom-context-menu](https://github.com/sulfide2085/dsh-custom-context-menu) | Extensible provider API for context menus. |
| [Nacocx/dsh-ui-context-menu](https://github.com/Nacocx/dsh-ui-context-menu) | Replaces the browser context menu with a DSH one. |

Use one of those if a single workspace is all you need.

## License

MIT — see [LICENSE](LICENSE).
