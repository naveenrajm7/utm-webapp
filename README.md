# UTM Web App

A local browser UI for controlling UTM on the same Mac. The longer-term goal is a
single UTM backend that can also support remote access and automation.

## Start 

The api requires `UTM_API_KEY`. Generate a secret and export it before starting:

```sh
export UTM_API_KEY="$(openssl rand -hex 32)"
npm run dev
```

The web UI will ask for that same key once per browser tab (stored in
`sessionStorage`) and send it on every REST call and WebSocket.

The web UI uses authenticated `/v1` routes for VM inventory, details, start,
stop, and job status. Older unversioned routes remain for compatibility.
`GET /status` is the only unauthenticated route (liveness). The API binds to
`127.0.0.1:3001` by default, so remote browser access is a later milestone.

The local VM flow and integration history are in
[`notes/AgentHandoff.md`](notes/AgentHandoff.md). Sandbox and MCP integration
remain paused.

## Browser acceptance

Run `npm ci`, `npm run build`, then `npm run test:browser` to exercise the real
browser UI against a deterministic fake API. The suite owns localhost ports
3000 and 3001 for its run, uses headless Chrome, and never mutates UTM. See
[`notes/Phase4BrowserAcceptance.md`](notes/Phase4BrowserAcceptance.md) for
coverage, environment, and the separate live integration gate.


## What's inside?

This Turborepo includes the following:

### Apps and Packages

- `web`: a [Next.js](https://nextjs.org/) app - Main UI for UTM Web, including the
  per-VM serial console (`/terminal/<uuid>`) and VNC display (`/vnc/<uuid>`).
- `api`: an [Express](https://expressjs.com/) server - providing APIs to control UTM.

The `api` runs on port 3001 and must run on the Mac hosting UTM. It uses
`packages/utm-adapter` for `/v1` and legacy VM inventory, details, and power
control, as well as serial and VNC endpoint discovery. The API owns REST,
jobs, authentication, and WebSocket bridging; UTM-specific calls stay in the
adapter. Start and stop require a VM that supports those actions.

## macOS installation

UTM Web installs per user and requires UTM in `/Applications/UTM.app`. It bundles Node and its runtime dependencies, including native `node-pty`; Node, npm, Git, Homebrew, and a checkout are not required on the target Mac. Release builds target Apple Silicon (`arm64`) and Intel (`x86_64`) separately.

After a versioned release is published, install with:

```sh
curl -fsSL https://raw.githubusercontent.com/naveenrajm7/utm-webapp/main/install.sh | bash -s -- --version v1.0.0
```

For a locally built archive, use `./install.sh --archive /path/to/utm-web-VERSION-macos-ARCH.tar.gz`. The matching `.sha256` file must sit beside it. The installer verifies SHA-256 before extraction, retains the API key and job journal during upgrades, activates a version atomically, and restores the prior version if readiness fails. Apple Silicon (`arm64`) and Intel (`x86_64`) Node/native bundles both passed the pull request’s GitHub-hosted build and install smoke jobs.

The service runs as a LaunchAgent in the logged-in user's session on `127.0.0.1:3000`. Open `http://127.0.0.1:3000`; retrieve the unlock key with `cat "$HOME/Library/Application Support/UTM Web/api-key"`. The key file is mode 0600 and is never included in release files or process arguments. Manage it with:

```sh
launchctl kickstart -k gui/$(id -u)/com.utmweb.server  # start/restart
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.utmweb.server.plist" # stop
launchctl print gui/$(id -u)/com.utmweb.server         # status
tail -f "$HOME/Library/Application Support/UTM Web/server.log" # logs
./install.sh --uninstall                              # preserve user data
./install.sh --uninstall --purge-data                 # delete user data too
```

To validate package assembly locally on a Mac, run `ARCH=$(uname -m) OUT_DIR="$PWD/release-out" ./scripts/build-release.sh`, then `./scripts/package-smoke.sh release-out/artifacts/utm-web-*-macos-*.tar.gz`. The package workflow builds and installs on GitHub-hosted Intel and Apple Silicon Macs; its simulated UTM app only satisfies prerequisite detection and it does not access a VM.
