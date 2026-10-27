# UTM Web App

A local browser UI for controlling UTM on the same Mac. The longer-term goal is a
single UTM backend that can also support remote access and automation.

## Start 

Run `npm ci` and `npm run dev` on the Mac hosting UTM. Open
`http://localhost:3000`. On first launch, copy the latest **initial setup code**
from the API terminal, choose an administrator username and a password of at
least 12 characters, then log in. Setup is available only until that single
administrator is created. Use the dashboard's **Log out** button to end the
session.

Accounts and sessions persist in
`~/Library/Application Support/UTM Web/utm.sqlite` (mode 0600); set
`UTM_DATABASE_PATH` to use another absolute path. Keep this file when upgrading
or restarting. Passwords are salted and hashed, and the browser receives an
HttpOnly session cookie that expires after eight hours. The browser does not
store a password or session token in JavaScript storage.

The UI uses authenticated `/v1` routes for VM inventory, details, management,
and jobs. Console WebSockets use the same session. The API binds to
`127.0.0.1:3001` during development; production serves the API and UI together
on `127.0.0.1:3000`. During development, open the web app using the same
hostname as its API (the default configuration does this automatically).
Remote access remains a later milestone.

Existing scripts can explicitly select the former shared-key flow by setting
`UTM_AUTH_MODE=api-key` and a random `UTM_API_KEY` before starting. Session mode
is the default, even if `UTM_API_KEY` is already set. In session mode the old
key grants no VM or console access. `/status` and `/ready` remain public health
checks; `/auth/status`, `/auth/setup`, and `/auth/login` support the login flow.
See [the authentication contract](notes/AdminAuthentication.md) for API details,
configuration, security boundaries, and verification.

The local VM flow and integration history are in
[`notes/AgentHandoff.md`](notes/AgentHandoff.md). Sandbox and MCP integration
remain paused.

## Browser acceptance

Run `npm ci`, `npm run build`, then `npm run test:browser` to exercise the real
browser UI against a deterministic fake API. The suite chooses available loopback ports, uses headless Chrome, and never mutates UTM. See
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

UTM Web installs per user and requires UTM in `/Applications/UTM.app`. It bundles Node and its runtime dependencies, including native `node-pty` and SQLite; Node, npm, Git, Homebrew, and a checkout are not required on the target Mac. Release builds target Apple Silicon (`arm64`) and Intel (`x86_64`) separately.

After a versioned release is published, install with:

```sh
curl -fsSL https://raw.githubusercontent.com/naveenrajm7/utm-webapp/main/install.sh | bash -s -- --version v1.0.0
```

For a locally built archive, use `./install.sh --archive /path/to/utm-web-VERSION-macos-ARCH.tar.gz`. The matching `.sha256` file must sit beside it. The installer verifies SHA-256 before extraction, retains the administrator database, installation health key, and job journal during upgrades, activates a version atomically, and restores the prior version if readiness fails. Apple Silicon (`arm64`) and Intel (`x86_64`) Node/native bundles both passed the pull request’s GitHub-hosted build and install smoke jobs.

The service runs as a LaunchAgent in the logged-in user's session on `127.0.0.1:3000`. Open `http://127.0.0.1:3000`; complete first-time admin setup using the latest setup code in `~/Library/Application Support/UTM Web/server.log`, then log in. The retained `api-key` file is used only to authenticate installer health checks in session mode. Manage it with:

```sh
launchctl kickstart -k gui/$(id -u)/com.utmweb.server  # start/restart
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.utmweb.server.plist" # stop
launchctl print gui/$(id -u)/com.utmweb.server         # status
tail -f "$HOME/Library/Application Support/UTM Web/server.log" # logs
./install.sh --uninstall                              # preserve user data
./install.sh --uninstall --purge-data                 # delete user data too
```

To validate package assembly locally on a Mac, run `ARCH=$(uname -m) OUT_DIR="$PWD/release-out" ./scripts/build-release.sh`, then `./scripts/package-smoke.sh release-out/artifacts/utm-web-*-macos-*.tar.gz`. The package workflow builds and installs on GitHub-hosted Intel and Apple Silicon Macs; its simulated UTM app only satisfies prerequisite detection and it does not access a VM.
