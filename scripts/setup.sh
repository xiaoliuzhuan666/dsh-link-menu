#!/usr/bin/env bash
# Install (or remove) dsh-link-menu, a PURE PLUGIN that adds a right-click menu
# to links in the DSH desktop chat.
#
#   bash dsh-link-menu-setup.sh              # install / update
#   bash dsh-link-menu-setup.sh --status     # what is installed
#   bash dsh-link-menu-setup.sh --revert     # remove the plugin, restore app files
#
# What you get
# ------------
#   file link right-click → Reveal in Finder · Copy File Path · Copy Relative Path
#   http link right-click → Open in Browser  · Copy Link Address
#
# What this script does NOT do
# ----------------------------
# It does not modify the application. No bundle patch, no ui-chat patch, no
# Electron main-process patch. Everything the menu needs already exists in a
# stock install:
#
#   * the file path        → `title` on the <button> the markdown renderer
#                            already produces (and on the edited-file card)
#   * the workspace root   → ctx.sessions.list.getSnapshot().byId[id].cwd
#   * the session id       → data-conversation-session on the conversation root
#   * the reveal           → remote.session.openWorkspacePath({action:"reveal"})
#
# All four were verified against 0.2.1-rc.5. That is why the plugin can ship
# from GitHub with `dsh plugin add` and needs no setup script at all — this
# script only exists to install it on a machine where the CLI is not handy, and
# to clean up the three app patches an earlier version of this feature applied.
#
# Why the earlier version patched the app, and why that was wrong
# --------------------------------------------------------------
# It assumed the path never reached the DOM and that the sidebar/chat window
# killed link clicks. Both were wrong: the path is in `title`, and the chat
# window's setWindowOpenHandler already forwards http(s) itself. The one handler
# that really was deny-only lives in `DesktopPolicyTestAuth` (the login window),
# so patching it changed auth behaviour and fixed nothing. See
# docs/2026-11-03-DSH链接右键调研事故复盘.md in the skillshare repo.
#
# The reveal path must be ABSOLUTE: fs.processPathFromHostPath returns undefined
# for anything relative, and the Host rejects it with "Path has no verified Host
# path". The plugin joins `cwd` + `title` before calling the Remote.
set -euo pipefail

APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
RES="$APP/Contents/Resources"
MAIN="$RES/app/lib/main.js"
CHAT="$RES/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js"
FRONTEND_DIR="$RES/app/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PLUGIN="$PROFILE/node_modules/dsh-link-menu"

# Markers left by the patch-era version, so --status and --revert can find them.
STALE_BUNDLE='data-dsh-file-abs'
STALE_MAIN='a malformed URL is not worth an error surface'
# The ui-chat marker spans two lines, so it cannot be a `grep -F` pattern:
# grep splits an embedded newline into several alternatives and any one hit
# would report a false positive on the unpatched file. Check it with python.

log()  { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -d "$APP" ] || fail "app not found: $APP
Set DSH_APP to your app bundle."

# The bundle filename carries a build hash that changes between app versions.
BUNDLE_REL="$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' "$FRONTEND_DIR/index.html" 2>/dev/null | head -1)"
BUNDLE=""
[ -n "$BUNDLE_REL" ] && BUNDLE="$FRONTEND_DIR/$BUNDLE_REL"

chat_patched() {
  [ -f "$CHAT" ] || return 1
  python3 - "$CHAT" <<'PY'
import sys
t = open(sys.argv[1], encoding="utf-8", errors="surrogateescape").read()
needle = "fileImages,\n\t\t\t\t\t\t\t\t\t\tcwd,"
sys.exit(0 if needle in t else 1)
PY
}

stale_state() { # prints one line per leftover app patch; true (1) when clean
  local found=1
  if [ -n "$BUNDLE" ] && [ -f "$BUNDLE" ] && grep -qF "$STALE_BUNDLE" "$BUNDLE" 2>/dev/null; then
    log "  ! bundle still stamped (data-dsh-file-abs) — a patch-era leftover"; found=0
  fi
  if chat_patched; then
    log "  ! ui-chat still passes cwd — a patch-era leftover"; found=0
  fi
  if [ -f "$MAIN" ] && grep -qF "$STALE_MAIN" "$MAIN" 2>/dev/null; then
    log "  ! main.js still carries the mis-targeted window-open patch"; found=0
  fi
  return $found
}

restore_from_backup() { # restore_from_backup <file> <label>
  local f="$1" label="$2"
  if [ -f "$f.dshbak" ]; then
    cp "$f.dshbak" "$f"
    log "  restored $label from $f.dshbak"
  else
    log "  ! $label still patched and no .dshbak to restore it from"
  fi
}

# ---------------------------------------------------------------- status ---
if [ "${1:-}" = "--status" ]; then
  log "app:    $APP"
  log "plugin: $PLUGIN"
  log ""
  if [ -f "$PLUGIN/lib/client.js" ]; then log "  ✓ plugin installed"; else log "  ✗ plugin not installed"; fi
  local_ok=0
  grep -qF "data-dsh-link-menu" "$PLUGIN/lib/client.js" 2>/dev/null && local_ok=1
  [ "$local_ok" = 1 ] && log "  ✓ client half looks like this version"
  if grep -q '"dsh-link-menu"' "$PROFILE/package.json" 2>/dev/null; then
    log "  ✓ registered in profile bundles"
  else
    log "  ✗ not registered in $PROFILE/package.json"
  fi
  log ""
  log "app patches (should all be clean):"
  stale_state || log "  ✓ none — the app is unmodified"
  exit 0
fi

# ---------------------------------------------------------------- revert ---
if [ "${1:-}" = "--revert" ]; then
  log "== removing the plugin =="
  rm -rf "$PLUGIN"
  log "  removed $PLUGIN"
  python3 - "$PROFILE" <<'PY'
import json, os, sys
profile = sys.argv[1]
path = os.path.join(profile, "package.json")
if not os.path.exists(path):
    print("  profile manifest missing; nothing to deregister")
    raise SystemExit(0)
data = json.load(open(path))
bundles = data.get("dsh", {}).get("profile", {}).get("bundles", [])
if "dsh-link-menu" in bundles:
    data["dsh"]["profile"]["bundles"] = [b for b in bundles if b != "dsh-link-menu"]
    json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")
    print("  deregistered from profile bundles")
else:
    print("  already absent from profile bundles")
PY
  log ""
  log "== restoring any patch-era app edits =="
  # Restore ONLY what is actually still patched. Copying a .dshbak over a clean
  # file would overwrite the user's current app with a possibly stale baseline,
  # which is worse than leaving a harmless leftover alone.
  if stale_state; then
    [ -n "$BUNDLE" ] && grep -qF "$STALE_BUNDLE" "$BUNDLE" 2>/dev/null && restore_from_backup "$BUNDLE" "bundle"
    chat_patched && restore_from_backup "$CHAT" "ui-chat"
    grep -qF "$STALE_MAIN" "$MAIN" 2>/dev/null && restore_from_backup "$MAIN" "main.js"
  else
    log "  ✓ nothing patched; no app file was touched"
  fi
  log ""
  log "quit and reopen DeepSeek Harness to take effect"
  exit 0
fi

[ -z "${1:-}" ] || fail "unknown option: $1 (use --status or --revert)"

# ---------------------------------------------------------------- install --
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Two layouts ship this script:
#   <repo>/scripts/setup.sh  with the package at <repo>/            (published repo)
#   <repo>/scripts/dsh-link-menu-setup.sh with it at scripts/dsh-link-menu/  (skillshare)
if [ -f "$HERE/package.json" ] && grep -q '"dsh-link-menu"' "$HERE/package.json" 2>/dev/null; then
  PKG_SRC="$HERE"
elif [ -f "$HERE/dsh-link-menu/package.json" ]; then
  PKG_SRC="$HERE/dsh-link-menu"
elif [ -f "$HERE/../package.json" ] && grep -q '"dsh-link-menu"' "$HERE/../package.json" 2>/dev/null; then
  PKG_SRC="$(cd "$HERE/.." && pwd)"
else
  fail "cannot find the dsh-link-menu package next to $HERE
Expected <here>/package.json, <here>/dsh-link-menu/package.json, or <here>/../package.json."
fi

log "== 1/3 copying the plugin =="
rm -rf "$PLUGIN"
mkdir -p "$PLUGIN"
# Copy exactly the package, not the enclosing repository: in the published
# layout PKG_SRC is the repo root, which also holds scripts/ and docs.
for item in package.json cordis.patch.yml lib; do
  [ -e "$PKG_SRC/$item" ] || fail "package is missing $item (looked in $PKG_SRC)"
  cp -R "$PKG_SRC/$item" "$PLUGIN/"
done
log "  $PLUGIN"

log ""
log "== 2/3 registering it in the profile =="
python3 - "$PROFILE" <<'PY'
import json, os, sys
profile = sys.argv[1]
os.makedirs(profile, exist_ok=True)
path = os.path.join(profile, "package.json")
data = json.load(open(path)) if os.path.exists(path) else {"name": "dsh-profile", "private": True}
bundles = data.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
if "dsh-link-menu" in bundles:
    print("  already in profile bundles")
else:
    bundles.append("dsh-link-menu")
    json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
    open(path, "a").write("\n")
    print("  added to profile bundles")

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
            print("  removed a leftover manual mount")
PY

log ""
log "== 3/3 cleaning up patch-era app edits =="
if stale_state; then
  log "  reverting them now (the plugin no longer needs any of them):"
  [ -n "$BUNDLE" ] && restore_from_backup "$BUNDLE" "bundle"
  restore_from_backup "$CHAT" "ui-chat"
  restore_from_backup "$MAIN" "main.js"
else
  log "  ✓ nothing to clean — the app was never patched, or is already clean"
fi

log ""
log "done. quit and reopen DeepSeek Harness."
log ""
log "verify in DevTools console:"
log "  document.documentElement.getAttribute('data-dsh-link-menu')   // \"active\""
log ""
log "undo with: bash $0 --revert"
