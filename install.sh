#!/bin/bash
set -euo pipefail
APP='UTM Web'; DATA="$HOME/Library/Application Support/$APP"; ROOT="$HOME/Applications/UTM Web"; LABEL='com.utmweb.server'
ARCHIVE=''; VERSION=${VERSION:-latest}; UNINSTALL=0; KEEP=1
usage(){ echo 'Usage: install.sh [--archive FILE] [--version TAG] [--uninstall [--purge-data]]'; }
while (($#)); do case "$1" in --archive) ARCHIVE=${2:?}; shift 2;; --version) VERSION=${2:?}; shift 2;; --uninstall) UNINSTALL=1; shift;; --purge-data) KEEP=0; shift;; -h|--help) usage; exit 0;; *) usage >&2; exit 2;; esac; done
[[ "$(id -u)" != 0 ]] || { echo 'Run UTM Web installer as your regular user, not with sudo.' >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || { echo 'UTM Web installer supports macOS only.' >&2; exit 1; }
case "$(uname -m)" in arm64) ARCH=arm64;; x86_64) ARCH=x86_64;; *) echo "Unsupported Mac architecture: $(uname -m)" >&2; exit 1;; esac
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if ((UNINSTALL)); then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  if ((KEEP)); then rm -rf "$ROOT"; echo "UTM Web removed. User data remains at: $DATA"; else rm -rf "$DATA" "$ROOT"; echo 'UTM Web and user data removed.'; fi
  exit 0
fi
[[ -d /Applications/UTM.app ]] || { echo 'UTM must already be installed at /Applications/UTM.app.' >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if [[ -n "$ARCHIVE" ]]; then ART="$ARCHIVE"; [[ -f "$ART.sha256" ]] || { echo 'Local archive must have a sibling .sha256 file.' >&2; exit 1; }; (cd "$(dirname "$ART")" && shasum -a 256 -c "$(basename "$ART").sha256")
else
  [[ "$VERSION" != latest ]] || { echo 'Specify a version tag with --version (for example v1.0.0).' >&2; exit 2; }
  BASE="https://github.com/naveenrajm7/utm-webapp/releases/download/$VERSION"
  ART="$TMP/utm-web-$VERSION-macos-$ARCH.tar.gz"
  curl --fail --location --proto '=https' --tlsv1.2 "$BASE/$(basename "$ART")" -o "$ART"
  curl --fail --location --proto '=https' --tlsv1.2 "$BASE/$(basename "$ART").sha256" -o "$ART.sha256"
  (cd "$TMP" && shasum -a 256 -c "$(basename "$ART").sha256")
fi
MANIFEST=$(tar -xOf "$ART" runtime/manifest)
ART_ARCH=$(printf '%s\n' "$MANIFEST" | sed -n 's/^arch=//p')
ART_VERSION=$(printf '%s\n' "$MANIFEST" | sed -n 's/^version=//p')
[[ "$ART_ARCH" == "$ARCH" ]] || { echo "Archive architecture '$ART_ARCH' does not match this Mac ('$ARCH')." >&2; exit 1; }
[[ "$ART_VERSION" =~ ^[A-Za-z0-9._+-]+$ ]] || { echo 'Release archive has an invalid version manifest.' >&2; exit 1; }
HASH=$(shasum -a 256 "$ART" | awk '{print $1}')
mkdir -p "$ROOT/versions" "$DATA" "$HOME/Library/LaunchAgents"
chmod 700 "$DATA"
NEW="$ROOT/versions/$ART_VERSION-$ARCH-${HASH:0:16}"
if [[ ! -d "$NEW" ]]; then
  STAGING="$ROOT/versions/.install-$$"; mkdir "$STAGING"
  if ! tar -xzf "$ART" -C "$STAGING"; then rm -rf "$STAGING"; echo 'Could not extract release archive.' >&2; exit 1; fi
  mv "$STAGING" "$NEW"
fi
RUNTIME="$NEW/runtime"
if [[ ! -f "$DATA/api-key" ]]; then umask 077; openssl rand -hex 32 > "$DATA/api-key"; fi
chmod 600 "$DATA/api-key"
PREV=$(readlink "$ROOT/current" 2>/dev/null || true)
ln -s "$NEW" "$ROOT/current.new"; mv -f "$ROOT/current.new" "$ROOT/current"
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>$LABEL</string><key>ProgramArguments</key><array><string>$ROOT/current/runtime/start</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string></dict><key>WorkingDirectory</key><string>$ROOT/current/runtime</string><key>StandardOutPath</key><string>$DATA/server.log</string><key>StandardErrorPath</key><string>$DATA/server.log</string></dict></plist>
PLISTXML
chmod 600 "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$DATA/runtime-version"
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  if [[ -n "$PREV" ]]; then ln -s "$PREV" "$ROOT/current.rollback"; mv -f "$ROOT/current.rollback" "$ROOT/current"; else rm -f "$ROOT/current"; fi
  launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
  echo 'UTM Web LaunchAgent failed to activate; prior version restored.' >&2
  exit 1
fi
for _ in {1..30}; do
  if [[ -f "$DATA/runtime-version" && "$(cat "$DATA/runtime-version")" == "$ART_VERSION" ]]; then
    PROBE_STATUS=$(printf 'header = "x-api-key: %s"\n' "$(cat "$DATA/api-key")" | curl --config - --silent --max-time 2 --output "$TMP/probe-response" --write-out '%{http_code}' http://127.0.0.1:3000/auth/installation 2>/dev/null || true)
    if [[ "$PROBE_STATUS" == 200 ]] && grep -Fqx '{"service":"utm-web","ready":true}' "$TMP/probe-response"; then
      echo "UTM Web installed. Open http://127.0.0.1:3000"
      echo "For first-time setup, find the latest setup code in: $DATA/server.log"
      exit 0
    fi
  fi
  sleep 1
done
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
if [[ -n "$PREV" ]]; then ln -s "$PREV" "$ROOT/current.rollback"; mv -f "$ROOT/current.rollback" "$ROOT/current"; else rm -f "$ROOT/current"; fi
launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
echo 'UTM Web failed readiness check; prior version restored.' >&2; tail -n 40 "$DATA/server.log" >&2 || true; exit 1
