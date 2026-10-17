#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=${VERSION:-$(git -C "$ROOT" describe --tags --always 2>/dev/null || echo 0.1.0)}
NODE_VERSION=${NODE_VERSION:-22.14.0}
ARCH=${ARCH:-$(uname -m)}
case "$ARCH" in arm64|x86_64) ;; *) echo "Unsupported build architecture: $ARCH" >&2; exit 2;; esac
OUT=${OUT_DIR:-$ROOT/release-out}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT"
if [[ ${SKIP_QUALITY:-0} != 1 ]]; then
  npm ci
  npm run build
  npm run lint
  npm test
fi
mkdir -p "$WORK/runtime/apps/api" "$WORK/runtime/apps/web" "$WORK/runtime/packages/utm-adapter" "$WORK/runtime/packages/logger" "$OUT/artifacts"
cp -R apps/api/dist "$WORK/runtime/apps/api/"
cp apps/api/package.json "$WORK/runtime/apps/api/"
cp -R apps/web/.next/standalone/. "$WORK/runtime/"
mkdir -p "$WORK/runtime/apps/web/.next"
cp -R apps/web/.next/static "$WORK/runtime/apps/web/.next/"
cp -R packages/utm-adapter/dist "$WORK/runtime/packages/utm-adapter/"
cp packages/utm-adapter/package.json "$WORK/runtime/packages/utm-adapter/"
cp -R packages/logger/dist "$WORK/runtime/packages/logger/"
cp packages/logger/package.json "$WORK/runtime/packages/logger/"
# Runtime API modules are installed from the same npm lockfile; native addons are built for this Node and architecture.
node - "$ROOT" "$WORK/runtime" <<'NODE'
const fs=require('fs'),path=require('path');
const [root, runtime]=process.argv.slice(2);
const packages=['body-parser','cors','express','morgan','node-pty','ws','next','react','react-dom','@novnc/novnc','@xterm/addon-fit','@xterm/xterm','bootstrap','bootstrap-icons'];
const dependencies=Object.fromEntries(packages.map(name=>[name,require(path.join(root,'node_modules',name,'package.json')).version]));
const manifest={name:'utm-web-runtime',private:true,version:'1.0.0',dependencies};
fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify(manifest,null,2));
NODE
mkdir -p "$WORK/runtime/node"
PLATFORM=$( [ "$ARCH" = arm64 ] && echo arm64 || echo x64 )
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$PLATFORM.tar.gz" -o "$WORK/node.tar.gz"
tar -xzf "$WORK/node.tar.gz" -C "$WORK"
cp "$WORK/node-v$NODE_VERSION-darwin-$PLATFORM/bin/node" "$WORK/runtime/node/node"
mkdir -p "$WORK/runtime/node/lib/node_modules"
cp -R "$WORK/node-v$NODE_VERSION-darwin-$PLATFORM/lib/node_modules/npm" "$WORK/runtime/node/lib/node_modules/"
chmod 755 "$WORK/runtime/node/node"
cd "$WORK/runtime"
PATH="$WORK/runtime/node:$PATH" CXXFLAGS="-std=c++17" npm_config_target="$NODE_VERSION" npm_config_arch="$([ "$ARCH" = arm64 ] && echo arm64 || echo x64)" npm_config_target_arch="$([ "$ARCH" = arm64 ] && echo arm64 || echo x64)" npm_config_disturl=https://nodejs.org/download/release "$WORK/runtime/node/node" "$WORK/runtime/node/lib/node_modules/npm/bin/npm-cli.js" install --omit=dev --no-audit --no-fund
"$WORK/runtime/node/node" -e "require('./node_modules/node-pty'); console.log('native node-pty loaded for bundled Node')"
# These workspace packages are local compiled outputs and not registry packages.
rm -rf node_modules/@repo
mkdir -p node_modules/@repo/logger node_modules/@repo/utm-adapter
cp -R "$WORK/runtime/packages/logger/." node_modules/@repo/logger/
cp -R "$WORK/runtime/packages/utm-adapter/." node_modules/@repo/utm-adapter/
cat > "$WORK/runtime/start" <<'START'
#!/bin/bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DATA="$HOME/Library/Application Support/UTM Web"
APP_VERSION=$(sed -n 's/^version=//p' "$HERE/manifest")
printf '%s\n' "$APP_VERSION" > "$DATA/runtime-version"
export PATH="$HERE/node:$PATH" NODE_PATH="$HERE/node_modules" PORT=3000
export UTM_API_KEY=$(cat "$DATA/api-key") UTM_API_JOB_JOURNAL_PATH="$DATA/api-jobs.json"
cd "$HERE"
exec "$HERE/node/node" "$HERE/apps/api/dist/production.js"
START
chmod 755 "$WORK/runtime/start"
printf 'version=%s\nnode=%s\narch=%s\n' "$VERSION" "$NODE_VERSION" "$ARCH" > "$WORK/runtime/manifest"
ART="$OUT/artifacts/utm-web-$VERSION-macos-$ARCH.tar.gz"
tar -czf "$ART" -C "$WORK" runtime
(cd "$(dirname "$ART")" && shasum -a 256 "$(basename "$ART")" > "$(basename "$ART").sha256")
printf 'artifact=%s\nsize_bytes=%s\n' "$ART" "$(stat -f %z "$ART" 2>/dev/null || stat -c %s "$ART")"
cd "$ROOT"
npm run build:demo --workspace=web
