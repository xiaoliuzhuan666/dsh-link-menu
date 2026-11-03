#!/usr/bin/env bash
# Add a right-click menu to links in the DSH desktop chat, and make external
# links open in the browser.
#
#   bash dsh-link-menu-setup.sh              # apply everything
#   bash dsh-link-menu-setup.sh --status     # what is applied
#   bash dsh-link-menu-setup.sh --revert     # undo every file edit
#
# What you get
# ------------
#   file link right-click → Reveal in Finder · Copy File Path
#   http link right-click → Open in Browser  · Copy Link Address
#   http link left click  → opens the system browser
#
# Why FOUR pieces
# ---------------
# This is not one patch. Each piece is load-bearing; drop one and the feature
# silently stops working:
#
#   1. dsh-web-frontend bundle  — stamps data-dsh-file-path / -abs on the
#      rendered link buttons. React props are not DOM attributes, so a plugin
#      cannot read the path otherwise. This is the file the BROWSER loads;
#      editing dsh-client-ui-* alone changes nothing.
#   2. dsh-client-ui-chat       — passes the session cwd into the markdown
#      delegate context, so piece 1 can resolve a relative path to absolute.
#   3. lib/main.js              — the window's setWindowOpenHandler denies every
#      window.open; hand http(s) to shell.openExternal first.
#   4. the plugin               — captures contextmenu and calls the Host Remote
#      session.openWorkspacePath({ action: "reveal" }), which is the only place
#      that can reveal a HOST path (the workspace root lives in the Host).
#
# The reveal path must be ABSOLUTE: fs.processPathFromHostPath returns
# undefined for anything relative, and the Host rejects it with
# "Path has no verified Host path".
set -euo pipefail

APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
RES="$APP/Contents/Resources"
MAIN="$RES/app/lib/main.js"
CHAT="$RES/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js"
FRONTEND_DIR="$RES/app/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PLUGIN="$PROFILE/node_modules/dsh-link-menu"

log()  { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -d "$APP" ] || fail "app not found: $APP
Set DSH_APP to your app bundle."

# The bundle filename carries a build hash that changes between app versions.
# Read it from index.html instead of hardcoding.
BUNDLE_REL="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$FRONTEND_DIR/index.html" 2>/dev/null | head -1)"
[ -n "$BUNDLE_REL" ] || fail "cannot find the JS bundle reference in $FRONTEND_DIR/index.html"
BUNDLE="$FRONTEND_DIR/$BUNDLE_REL"

# ---------------------------------------------------------------- status ---
if [ "${1:-}" = "--status" ]; then
  check() { # check <file> <marker> <label>
    if [ -f "$1" ] && grep -qF "$2" "$1" 2>/dev/null; then log "  ✓ $3"; else log "  ✗ $3"; fi
  }
  log "app: $APP"
  log "bundle: ${BUNDLE_REL:-<missing>}"
  log "plugin: $PLUGIN"
  log ""
  check "$BUNDLE" "data-dsh-file-abs"        "1. bundle stamps data-dsh-file-abs"
  check "$CHAT"   "fileImages,
										cwd,"      "2. ui-chat passes cwd"
  check "$MAIN"   "shell.openExternal(url)"  "3. main.js opens external links"
  if [ -f "$PLUGIN/lib/client.js" ]; then log "  ✓ 4. plugin installed"; else log "  ✗ 4. plugin installed"; fi
  log ""
  log "backups:"
  for f in "$BUNDLE" "$CHAT" "$MAIN"; do
    [ -f "$f.dshbak" ] && log "  $f.dshbak"
  done
  exit 0
fi

# ---------------------------------------------------------------- revert ---
if [ "${1:-}" = "--revert" ]; then
  for f in "$BUNDLE" "$CHAT" "$MAIN"; do
    if [ -f "$f.dshbak" ]; then
      cp "$f.dshbak" "$f"
      log "reverted: $f"
    fi
  done
  log ""
  log "The plugin stays installed; remove it with:"
  log "  rm -rf $PLUGIN"
  log "  # then drop \"dsh-link-menu\" from $PROFILE/package.json"
  log ""
  log "quit and reopen DeepSeek Harness to take effect"
  exit 0
fi

[ -z "${1:-}" ] || fail "unknown option: $1 (use --status or --revert)"

# ---------------------------------------------------------------- apply ---
python3 - "$BUNDLE" "$CHAT" "$MAIN" "$PLUGIN" "$PROFILE" <<'PY'
import json, os, pathlib, shutil, sys

bundle, chat, main, plugin, profile = sys.argv[1:6]
notes = []

def backup(path):
    b = path + ".dshbak"
    if not os.path.exists(b):
        shutil.copy2(path, b)
        notes.append(f"backup: {b}")

def edit(path, pairs, label):
    """Apply (old, new, marker) triples in file order.

    `marker` is a short, stable string that exists only in the patched file. It
    decides idempotency, because `new` may contain prose that differs between
    app builds and would make an already-patched file look unpatched.
    """
    t = open(path, encoding="utf-8", errors="surrogateescape").read()
    changed = False
    for old, new, marker in pairs:
        if marker in t:                   # already applied
            continue
        if old not in t:
            sys.exit(f"anchor not found in {path}: {label}\n"
                     f"  the app changed; re-derive this anchor from the live file\n"
                     f"  missing marker: {marker!r}")
        t = t.replace(old, new, 1)
        changed = True
    if changed:
        open(path, "w", encoding="utf-8", errors="surrogateescape").write(t)
        notes.append(f"patched: {path}")
    else:
        notes.append(f"already patched: {path}")

# ---- 1. the bundle the browser loads --------------------------------------
backup(bundle)
edit(bundle, [
    # 1a. file-mention button: stamp the visible path and the resolved one
    (
      'function cU({file:e,glyph:t,children:r}){const{openFile:i,fileImages:n}=f4();'
      'if(i===void 0)return d.jsx(d.Fragment,{children:r});const s=t&&I1(e.path)==="image"?n:void 0,'
      'l=s?.resolve(e.path),u=d.jsxs("button",{type:"button",className:he(St.fileMention,St.fileLink),'
      '"data-dsh-file-path":e.path,',
      'function cU({file:e,glyph:t,children:r}){const{openFile:i,fileImages:n,cwd:cw}=f4();'
      'if(i===void 0)return d.jsx(d.Fragment,{children:r});const s=t&&I1(e.path)==="image"?n:void 0,'
      'l=s?.resolve(e.path),absPath=cw!==void 0&&cw!==""&&!(e.path.startsWith("/")||/^[A-Za-z]:[/\\\\]/.test(e.path))'
      '?cw.replace(/\\\\/g,"/").replace(/\\/+$/,"")+"/"+e.path.replace(/^\\.\\//,""):e.path,'
      'u=d.jsxs("button",{type:"button",className:he(St.fileMention,St.fileLink),'
      '"data-dsh-file-path":e.path,"data-dsh-file-abs":absPath,',
      'data-dsh-file-abs":absPath',      # marker: unique to the patched cU
    ),
    # 1b. inline-code file mention
    (
      'return s!==void 0?d.jsx("code",{children:d.jsxs("button",{type:"button",'
      'className:St.fileMention,"data-dsh-file-path":i,',
      'return s!==void 0?d.jsx("code",{children:d.jsxs("button",{type:"button",'
      'className:St.fileMention,"data-dsh-file-path":i,'
      '"data-dsh-file-abs":(function(){try{const q=s&&s.cwd;if(typeof q!=="string"||q==="")return i;'
      'if(i.startsWith("/")||/^[A-Za-z]:[/\\\\]/.test(i))return i;'
      'return q.replace(/\\\\/g,"/").replace(/\\/+$/,"")+"/"+i.replace(/^\\.\\//,"")}catch{return i}})(),',
      'catch{return i}})(),',            # marker: unique to the patched inlineCode
    ),
    # 1c. markdown delegate provider must forward cwd
    (
      'function XF({children:e,openExternalLink:t,openFile:r,fileImages:i}){'
      'const n=C.useMemo(()=>({openExternalLink:t,openFile:r,fileImages:i}),[t,r,i]);',
      'function XF({children:e,openExternalLink:t,openFile:r,fileImages:i,cwd:a}){'
      'const n=C.useMemo(()=>({openExternalLink:t,openFile:r,fileImages:i,cwd:a}),[t,r,i,a]);',
      'fileImages:i,cwd:a}),[t,r,i,a])',  # marker: unique to the patched provider
    ),
], "bundle link stamping")

# ---- 2. ui-chat: hand cwd to the markdown context -------------------------
backup(chat)
edit(chat, [
    (
      '(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownDelegateProvider, {\n'
      '\t\t\t\t\t\t\t\t\t\topenFile: requestOpenFile,\n'
      '\t\t\t\t\t\t\t\t\t\topenExternalLink,\n'
      '\t\t\t\t\t\t\t\t\t\tfileImages,',
      '(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownDelegateProvider, {\n'
      '\t\t\t\t\t\t\t\t\t\topenFile: requestOpenFile,\n'
      '\t\t\t\t\t\t\t\t\t\topenExternalLink,\n'
      '\t\t\t\t\t\t\t\t\t\tfileImages,\n'
      '\t\t\t\t\t\t\t\t\t\tcwd,',
      'fileImages,\n\t\t\t\t\t\t\t\t\t\tcwd,',   # marker: unique to the patched provider call
    ),
], "ui-chat cwd")

# ---- 3. main.js: external links -----------------------------------------
backup(main)
edit(main, [
    (
      '\t\tcontents.setWindowOpenHandler(() => ({ action: "deny" }));\n'
      '\t\tcontents.on("will-navigate", (event, url) => {\n'
      '\t\t\tif (!this.allowed(url)) {',
      '\t\tcontents.setWindowOpenHandler(({ url }) => {\n'
      '\t\t\t// A chat link calls window.open(url, "_blank"). A deny-only handler\n'
      '\t\t\t// swallowed every one of those clicks: nothing opened, no error.\n'
      '\t\t\t// Hand http(s) to the system browser, deny the rest \u2014 same posture\n'
      '\t\t\t// as the WebContentsView handler above.\n'
      '\t\t\ttry {\n'
      '\t\t\t\tconst destination = new URL(url);\n'
      '\t\t\t\tif ((destination.protocol === "https:" || destination.protocol === "http:") && !destination.username && !destination.password)\n'
      '\t\t\t\t\tshell.openExternal(url).catch(() => {});\n'
      '\t\t\t} catch {\n'
      '\t\t\t\t/* a malformed URL is not worth an error surface */\n'
      '\t\t\t}\n'
      '\t\t\treturn { action: "deny" };\n'
      '\t\t});\n'
      '\t\tcontents.on("will-navigate", (event, url) => {\n'
      '\t\t\tif (!this.allowed(url)) {',
      'a malformed URL is not worth an error surface',   # marker: unique to the patched handler
    ),
], "main.js window-open")

# ---- 4. the plugin --------------------------------------------------------
os.makedirs(os.path.join(plugin, "lib"), exist_ok=True)
notes.append(f"plugin dir: {plugin}")

print("\n".join(notes))
PY

log ""
log "1/4 bundle, 2/4 ui-chat, 3/4 main.js patched"

# ---- 4. write the plugin files -------------------------------------------
mkdir -p "$PLUGIN/lib"

cat > "$PLUGIN/package.json" <<'JSON'
{
  "name": "dsh-link-menu",
  "version": "0.1.0",
  "private": true,
  "description": "Right-click menu for chat links: reveal in Finder, copy path, open in browser, copy link address.",
  "type": "module",
  "main": "lib/index.js",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" },
    "manifestVersion": 1
  },
  "exports": {
    ".": { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "engines": { "node": ">=20" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.5" }
}
JSON

cat > "$PLUGIN/cordis.patch.yml" <<'YAML'
# Bundle patch: the row that mounts this plugin.
# A manual row in the profile's own cordis.patch.yml mounts the HOST half only;
# the client half loads through the bundle channel.
- insert:
    - id: dsh-link-menu
      name: dsh-link-menu
YAML

cat > "$PLUGIN/lib/index.js" <<'JS'
/**
 * Host half of dsh-link-menu.
 *
 * All the work is in the browser. This file exists because the client-module
 * scanner skips any loader entry whose Host fiber never started, so a
 * client-only plugin still needs a Host half that imports cleanly.
 */

export const name = "dsh-link-menu";

/** Nothing is read from the Host context. */
export const inject = [];

/** Intentionally empty. */
export function apply() {}
JS

# The plugin source ships in ../plugin/client.js, next to this script's directory.
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugin/client.js"
[ -f "$TEMPLATE" ] || fail "plugin template missing: $TEMPLATE
It ships beside this script; copy it there before running."
cp "$TEMPLATE" "$PLUGIN/lib/client.js"

log "4/4 plugin written: $PLUGIN"

# ---- register in the profile ---------------------------------------------
python3 - "$PROFILE" <<'PY'
import json, os, sys, yaml
profile = sys.argv[1]
pkg_path = os.path.join(profile, "package.json")
data = json.load(open(pkg_path))
bundles = data.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
if "dsh-link-menu" not in bundles:
    bundles.append("dsh-link-menu")
    json.dump(data, open(pkg_path, "w"), indent=2, ensure_ascii=False)
    open(pkg_path, "a").write("\n")
    print("registered in profile bundles")
else:
    print("already in profile bundles")

# A leftover manual mount would double-mount the plugin.
patch_path = os.path.join(profile, "cordis.patch.yml")
if os.path.exists(patch_path):
    t = open(patch_path, encoding="utf-8").read()
    start = t.find("# >>> dsh-link-menu")
    if start != -1:
        end = t.find("# <<< dsh-link-menu <<<")
        if end != -1:
            end += len("# <<< dsh-link-menu <<<\n")
            open(patch_path, "w", encoding="utf-8").write(t[:start] + t[end:])
            print("removed a leftover manual mount")
PY

log ""
log "done. quit and reopen DeepSeek Harness."
log ""
log "verify in DevTools console:"
log "  document.documentElement.getAttribute('data-dsh-link-menu')   // \"active\""
log ""
log "undo with: bash $0 --revert"
