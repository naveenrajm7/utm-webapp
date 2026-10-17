#!/bin/bash
set -euo pipefail
ARCHIVE=${1:?archive required}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
# Simulate the documented UTM prerequisite on hosted macOS; no real VM is accessed.
if [[ ! -d /Applications/UTM.app ]]; then sudo mkdir -p /Applications/UTM.app; fi
PATH="$TMP/no-system-node:/usr/bin:/bin:/usr/sbin:/sbin"; mkdir -p "$TMP/no-system-node"
export PATH
for tool in node npm; do
  if command -v "$tool" >/dev/null 2>&1; then echo "System $tool unexpectedly available on smoke PATH." >&2; exit 1; fi
done
"$ROOT/install.sh" --archive "$ARCHIVE"
RUNTIME="$HOME/Applications/UTM Web/current/runtime"
test -x "$RUNTIME/node/node"
test -f "$RUNTIME/packages/utm-adapter/dist/scripts/utm.jxa.js"
test -d "$RUNTIME/apps/web/.next/static"
"$RUNTIME/node/node" -e "require('$RUNTIME/node_modules/node-pty'); console.log('node-pty native module loaded')"
EXPECTED_ARCH="$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )" "$RUNTIME/node/node" -e 'if(process.arch!==process.env.EXPECTED_ARCH)process.exit(1)'
curl -fsS http://127.0.0.1:3000/ > "$TMP/index.html"
ASSET=$(grep -oE 'src="/_next/static/[^" ]+\.js' "$TMP/index.html" | head -1 | cut -d '"' -f2)
[[ -n "$ASSET" ]]
curl -fsS "http://127.0.0.1:3000$ASSET" >/dev/null
KEY=$(cat "$HOME/Library/Application Support/UTM Web/api-key")
API_CHECK=http://127.0.0.1:3000/v1/jobs/00000000-0000-0000-0000-000000000000
code=$(curl -sS -o "$TMP/body" -w '%{http_code}' -H "Authorization: Bearer $KEY" "$API_CHECK")
[[ "$code" == 404 ]]
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$API_CHECK") == 401 ]]
printf '{"version":1,"jobs":[]}\n' > "$HOME/Library/Application Support/UTM Web/api-jobs.json"
cp "$HOME/Library/Application Support/UTM Web/api-key" "$TMP/key.before"
cp "$HOME/Library/Application Support/UTM Web/api-jobs.json" "$TMP/journal.before"
"$ROOT/install.sh" --archive "$ARCHIVE"
cmp "$TMP/key.before" "$HOME/Library/Application Support/UTM Web/api-key"
cmp "$TMP/journal.before" "$HOME/Library/Application Support/UTM Web/api-jobs.json"
ACTIVE_BEFORE=$(readlink "$HOME/Applications/UTM Web/current")
mkdir "$TMP/broken"
tar -xzf "$ARCHIVE" -C "$TMP/broken"
printf '%s\n' '#!/bin/sh' 'exit 1' > "$TMP/broken/runtime/start"
sed 's/^version=.*/version=broken-test/' "$TMP/broken/runtime/manifest" > "$TMP/broken/runtime/manifest.new"
mv "$TMP/broken/runtime/manifest.new" "$TMP/broken/runtime/manifest"
chmod 755 "$TMP/broken/runtime/start"
tar -czf "$TMP/broken.tar.gz" -C "$TMP/broken" runtime
(cd "$TMP" && shasum -a 256 broken.tar.gz > broken.tar.gz.sha256)
if "$ROOT/install.sh" --archive "$TMP/broken.tar.gz" > "$TMP/rollback.log" 2>&1; then
  cat "$TMP/rollback.log" >&2
  echo 'Expected the broken archive activation to roll back.' >&2
  exit 1
fi
[[ "$(readlink "$HOME/Applications/UTM Web/current")" == "$ACTIVE_BEFORE" ]]
for _ in {1..30}; do
  if [[ "$(cat "$HOME/Library/Application Support/UTM Web/runtime-version" 2>/dev/null || true)" == "$(sed -n 's/^version=//p' "$HOME/Applications/UTM Web/current/runtime/manifest")" ]] && curl -fsS http://127.0.0.1:3000/ >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3000/ >/dev/null
launchctl kickstart -k "gui/$(id -u)/com.utmweb.server"
launchctl print "gui/$(id -u)/com.utmweb.server" >/dev/null
"$ROOT/install.sh" --uninstall
[[ -f "$HOME/Library/Application Support/UTM Web/api-key" ]]
"$ROOT/install.sh" --uninstall --purge-data
printf 'local archive install, UI, auth, node-pty, adapter payload, reinstall, rollback, LaunchAgent, uninstall: passed\n'
