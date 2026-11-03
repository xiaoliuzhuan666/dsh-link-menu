# dsh-link-menu

A right-click menu for links in the DeepSeek Harness chat — **install it like
any other plugin, no patching, no setup script.**

Right-click a file reference in a message:

| Item | What it does |
|---|---|
| **Reveal in Finder** / 在 Finder 中显示 | Selects the file in Finder (`explorer /select` on Windows) |
| **Copy File Path** / 复制文件路径 | Copies the absolute path |
| **Copy Relative Path** / 复制相对路径 | Copies the path as the chat shows it |

Right-click an `http(s)` link:

| Item | What it does |
|---|---|
| **Open in Browser** / 在浏览器中打开 | Hands the URL to the system browser |
| **Copy Link Address** / 复制链接地址 | Copies the URL |

## Install

```
dsh plugin --profile desktop add github:xiaoliuzhuan666/dsh-link-menu
```

Then quit and reopen DeepSeek Harness. No `setup.sh`, no file edits, no
re-signed app bundle.

Verify it loaded — in DevTools console:

```js
document.documentElement.getAttribute('data-dsh-link-menu')   // "active"
```

## Nothing is patched

This started as a patch set and is now a plain plugin. It was rewritten after
finding that all four things it needs already exist in a stock install:

| What the menu needs | Where it comes from | Patched? |
|---|---|---|
| the file path | `title` on the `<button>` the markdown renderer already produces | no |
| the workspace root | `ctx.sessions.list.getSnapshot().byId[id].cwd` | no |
| the session id | `data-conversation-session` on the conversation root | no |
| the reveal | `remote.session.openWorkspacePath({ action: "reveal" })` | no |

The native Electron context menu cannot help here — DSH renders a file mention
as `<button>`, not `<a href>`, so Chromium reports `params.linkURL === ""` and
`main.js` never sees the target. So the plugin draws its own popup and
`preventDefault()`s the native one. That is a normal client-plugin surface, not
a workaround.

## Why an absolute path

`remote.session.openWorkspacePath` requires one. The Host maps it with
`fs.processPathFromHostPath`, which returns `undefined` for anything relative
and fails with `"Path has no verified Host path"`. The `title` on a mention is
often workspace-relative, so the plugin joins it onto the session's `cwd`
first, keeping the OS separator style (POSIX `/`, Windows `\`).

If a path cannot be resolved — no session in the DOM, no `cwd` on the store —
the plugin leaves the native menu alone and shows a short toast instead of
offering an action that would fail silently.

## Requirements

- DeepSeek Harness `>= 0.2.1-rc.1` (verified on `0.2.1-rc.5`, macOS arm64)
- Node `>= 20`

## Related

Several plugins cover adjacent ground and are worth a look if this one does not
fit: `dsh-filemenu`, `dsh-file-context-menu`, `dsh-link-context-menu`,
`dsh-better-sidebar`. This package is deliberately narrow: chat links only,
zero app patches.

## Development

The source of truth is the `scripts/dsh-link-menu/` directory in the parent
skillshare repository; this repo is its published mirror. Layout:

```
package.json          declarations: dsh.bundle.patch + dsh.client.platform + exports["./client"]
cordis.patch.yml      the one loader row that mounts the plugin
lib/index.js          Host half (empty on purpose: a client-only plugin still needs one)
lib/client.js         Browser half: contextmenu handler, popup, path resolution
scripts/setup.sh      offline installer for machines without the CLI
```

`scripts/setup.sh` also cleans up the three app patches that an earlier version
of this plugin used to apply.

## License

MIT
