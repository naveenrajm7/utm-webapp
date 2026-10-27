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
"$RUNTIME/node/node" -e "const D=require('$RUNTIME/node_modules/better-sqlite3'); const db=new D(':memory:'); db.prepare('SELECT 1').get(); db.close()"
"$RUNTIME/node/node" -e "require('$RUNTIME/node_modules/node-pty'); console.log('node-pty native module loaded')"
EXPECTED_ARCH="$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )" "$RUNTIME/node/node" -e 'if(process.arch!==process.env.EXPECTED_ARCH)process.exit(1)'
curl -fsS http://127.0.0.1:3000/ > "$TMP/index.html"
ASSET=$(grep -oE 'src="/_next/static/[^" ]+\.js' "$TMP/index.html" | head -1 | cut -d '"' -f2)
[[ -n "$ASSET" ]]
curl -fsS "http://127.0.0.1:3000$ASSET" >/dev/null
KEY=$(cat "$HOME/Library/Application Support/UTM Web/api-key")
AUTH_ORIGIN=http://127.0.0.1:3000
API_CHECK=$AUTH_ORIGIN/v1/jobs/00000000-0000-0000-0000-000000000000
# A retained installation credential can check identity, but cannot bypass admin login.
[[ $(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$API_CHECK") == 401 ]]
curl -fsS "$AUTH_ORIGIN/auth/status" | grep -Fq '"setupRequired":true'
SETUP_CODE=$(sed -n 's/.*UTM Web initial setup code: //p' "$HOME/Library/Application Support/UTM Web/server.log" | tail -1)
printf '{"username":"admin","password":"package smoke password","setupCode":"%s"}' "$SETUP_CODE" > "$TMP/setup.json"
curl -fsS -H "Origin: $AUTH_ORIGIN" -H 'X-UTM-Request: 1' -H 'Content-Type: application/json' --data-binary "@$TMP/setup.json" "$AUTH_ORIGIN/auth/setup" >/dev/null
printf '{"username":"admin","password":"package smoke password"}' > "$TMP/login.json"
curl -fsS -c "$TMP/cookies" -H "Origin: $AUTH_ORIGIN" -H 'X-UTM-Request: 1' -H 'Content-Type: application/json' --data-binary "@$TMP/login.json" "$AUTH_ORIGIN/auth/login" >/dev/null
[[ $(curl -sS -b "$TMP/cookies" -o /dev/null -w '%{http_code}' "$API_CHECK") == 404 ]]
[[ $(curl -sS -o /dev/null -w '%{http_code}' "$API_CHECK") == 401 ]]
curl -fsS "$AUTH_ORIGIN/auth/status" | grep -Fq '"setupRequired":false'
cp "$HOME/Library/Application Support/UTM Web/utm.sqlite" "$TMP/database.before"
printf '{"version":1,"jobs":[]}\n' > "$HOME/Library/Application Support/UTM Web/api-jobs.json"
cp "$HOME/Library/Application Support/UTM Web/api-key" "$TMP/key.before"
cp "$HOME/Library/Application Support/UTM Web/api-jobs.json" "$TMP/journal.before"
"$ROOT/install.sh" --archive "$ARCHIVE"
cmp "$TMP/database.before" "$HOME/Library/Application Support/UTM Web/utm.sqlite"
[[ $(curl -sS -b "$TMP/cookies" -o /dev/null -w '%{http_code}' "$API_CHECK") == 404 ]]
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
cp "$RUNTIME/node/node" "$TMP/node"
"$ROOT/install.sh" --uninstall
[[ -f "$HOME/Library/Application Support/UTM Web/api-key" ]]
"$ROOT/install.sh" --uninstall --purge-data
"$TMP/node" -e 'require("http").createServer((req,res)=>{res.writeHead(200);res.end("unrelated service")}).listen(3000,"127.0.0.1")' &
FAKE_PID=$!
trap 'kill "$FAKE_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
for _ in {1..30}; do
  if [[ "$(curl -fsS --max-time 1 http://127.0.0.1:3000/status 2>/dev/null || true)" == 'unrelated service' ]]; then break; fi
  sleep 1
done
[[ "$(curl -fsS --max-time 1 http://127.0.0.1:3000/status)" == 'unrelated service' ]]
if "$ROOT/install.sh" --archive "$ARCHIVE" > "$TMP/occupied-port.log" 2>&1; then
  cat "$TMP/occupied-port.log" >&2
  echo 'Installer accepted an unrelated service on port 3000.' >&2
  exit 1
fi
grep -Fq 'failed readiness check' "$TMP/occupied-port.log"
"$ROOT/install.sh" --uninstall --purge-data
kill "$FAKE_PID" 2>/dev/null || true
wait "$FAKE_PID" 2>/dev/null || true
FAKE_PID=''
printf 'local archive install, UI, auth, node-pty, adapter payload, reinstall, rollback, LaunchAgent, uninstall, occupied-port rejection: passed\n'
