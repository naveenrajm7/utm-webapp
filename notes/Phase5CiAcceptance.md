# Phase 5 CI and live acceptance

## Pull request gate

`.github/workflows/quality-gate.yml` runs on a GitHub-hosted `macos-latest`
runner with Node 22 and the runner's Google Chrome. It runs `npm ci`, the
repository build, lint, and unit suites, then `npm run test:browser`. The
browser command builds the production web app for two available loopback ports
and runs its fake-backed acceptance suite. When the production one-origin
runtime is present, it also builds the API and web app for that runtime and
checks REST and both console upgrades on the same loopback port.
`BROWSER_WEB_PORT` and
`BROWSER_API_PORT` can select explicit ports; otherwise it selects available
ports. `CHROME_PATH` can override the local Chrome executable. No UTM app,
VM, guest, or self-hosted runner is required.

The GitHub Pages preview remains in its separate `pages.yml` workflow and
continues to build the static demo after pushes to `main`.

## Manual live checklist

Use a **named disposable VM or disposable clone** on the Mac with UTM installed.
Record its exact name and UUID before touching it. Never start, stop, edit,
clone, or delete a personal VM. Do not run these steps in CI.

1. Record the UTM version and `utmctl list --hide`; confirm the named VM's UUID,
   name, backend, and stopped state against authenticated `/v1/vms` and
   `/v1/vms/<UUID>` responses.
2. Set a fresh `UTM_API_KEY` and start the production local runtime. Unlock the
   browser with that key. Confirm inventory, details, and the installed build's
   advertised serial/display capabilities agree. Stop if the target identity
   or capabilities are unexpected.
3. Start only the disposable VM through the browser. Record the POST path, job
   ID, terminal job result, and refreshed running state in browser and API.
4. If serial is supported, open its direct terminal page. Confirm the socket
   connects, then disconnect/reconnect and reload that page. Record whether
   output arrives or the session stays quiet. If unsupported, verify the gate
   explains why and do not attempt a socket.
5. If display is supported and UTM provides a VNC endpoint, open its direct
   display page. Confirm the display connects, then disconnect/reconnect and
   reload that page. If unsupported or unavailable, record the API capability,
   UI message, and exact reason; do not claim a VNC handshake passed.
6. Use the browser's Force stop control only on the disposable VM. Record the
   POST path, job ID, terminal job result, and stopped state in browser, API, and
   `utmctl list --hide`. Confirm any source VM remains unchanged.

The named historical disposable source is
`vagrant_test_default_1744595654130_77151`
(`10EC4AB2-91F6-42AB-A3DF-0996C75B80CF`). Recheck its identity and
disposable status before any live mutation. It last reported serial support
and no display support; a live VNC check therefore needs another explicitly
named disposable VM with a verified display capability.

## Verification record

On 2026-10-15, before the production one-origin runtime was available in this
branch, local Node 23.4.0 and Chrome 155.0.8059.40 checks passed: `npm ci`
installed 831 packages; `npm run build` passed 4/4 tasks; `npm run lint`
passed 7/7 tasks; `npm test` passed 102 tests (logger 1, adapter 22, API 48,
web 31); and `npm run test:browser` passed all eight fake API scenarios
(9/9 Node test results, including the parent test). The first expanded
browser run found a pending-job timing race in the harness; it was fixed by
waiting for the stored job ID before checking it. The second run passed.
`npm run build:demo --workspace=web` also passed, generating 14 static pages
for the existing GitHub Pages preview.

In a temporary integration worktree based on runtime commit `9dd11a8` from
PR #27 plus this acceptance branch, `npm ci` installed 831 packages,
`npm run build` passed 4/4 tasks, `npm run lint` passed 7/7 tasks, and
`npm test` passed 105 tests (logger 1, adapter 22, API 50, web 32).
`npm run test:browser` passed 9/9 fake API Node results and 1/1 production
one-origin result, including REST, serial reconnect/direct reload, and the
VNC upgrade on the same listener. This combined run exposed an old/new
WebSocket path mismatch in the fake; accepting both route sets fixed it.
The integrated `npm run build:demo --workspace=web` passed and generated
14 static pages.

## Live disposable-VM result (2026-10-15)

Using the combined production runtime on `127.0.0.1:3000` with a fresh API
key and separate journal, authenticated `/v1/capabilities`, `/v1/vms`, and
`/v1/vms/10EC4AB2-91F6-42AB-A3DF-0996C75B80CF` returned 200. UTM 5.0.6
reported the exact named source stopped, QEMU, 4096 MiB, automatic CPU,
`serial: true`, and `display: false`. The API returned 30 inventory items.

Only that disposable source was started and stopped. An API start job
`1cad8e88-f2e4-4310-bf8b-7e81b87b2bde` and stop job
`d0150fdc-3c48-4eb4-8080-63031d96dc52` both succeeded, with state
readback. The browser connected to `ws://127.0.0.1:3000/ws/serial`, recovered
after its WebSocket was closed, and reconnected after a direct page reload.
The serial transport connected; guest output was not asserted. The live VNC
page showed its unsupported-display gate and opened no VNC socket, so a live
VNC handshake remains unrun.

The browser start control also produced succeeded job
`7ac26662-a0e9-4a0a-b3f3-7aed75430ac8`. Its force-stop control produced
job `9fee59d3-785f-4434-8172-713562f72a77`, subsequently confirmed
`succeeded` with stopped API and `utmctl` state. A prior browser harness
attempt clicked stop before the start job cleared; its fallback API stop
`c26bf0b8-ba27-47d0-8138-9048e27ddd74` succeeded. The final harness
queried the browser stop job while it was still `running`; a subsequent API
read confirmed success. These were harness timing errors, not product job
failures. The source ended stopped. No personal VM was changed.

`utmctl list --hide` emitted two `OSStatus error -10004` event messages before
exiting 0 with the stopped source present. The one-origin suite was
repeated after PR #27 merged; see final verification below. PR #26's
GitHub Actions run `38783547114` passed `npm ci`, build, lint, unit tests, runner Chrome
discovery, and fake browser acceptance on `macos-latest`; it preceded
PR #27. The integrated Actions run is tracked on PR #26.

## Final integrated verification (2026-10-17)

After PR #27 merged as `772d20d`, this branch merged `origin/main` and ran a
clean `npm ci` (831 packages), `npm run build` (4/4 tasks), `npm run lint`
(7/7 tasks), and `npm run test` (105 tests: logger 1, adapter 22, API 50,
web 32). `npm run test:browser` passed all eight fake API scenarios (9/9 Node
results) and the production one-origin suite (1/1 result). The latter used
one loopback listener for the built UI, authenticated REST, serial reconnect
and direct reload, and a fake VNC bridge. `npm run build:demo --workspace=web`
passed with 14 static pages. All commands exited 0.

A separate real UTM 5.0.6 run used production UI/API on `127.0.0.1:3000`
with a fresh API key and journal, and a uniquely named clone of the designated
stopped Vagrant source. The clone UUID was
`3EEFDAA3-2C0E-436E-B939-33A904D3CD38`. The browser authenticated
inventory and detail, checked dialog keyboard focus/Escape, and opened the
clone's serial console through `/ws/serial`. Direct page reload reopened the
terminal. Stopping the server showed connection loss; after restart, the
Reconnect action refreshed VM detail and reopened serial. After the clone
stopped, Reconnect showed the stopped-VM gate without opening a serial
transport. The VNC page showed the unsupported-display gate with no VNC
transport because the source and clone advertise `display: false`. The clone
was stopped and deleted. The source remained stopped and unchanged. A live
VNC handshake still requires a separate verified disposable VM with display.

The prior 2026-10-15 browser start/force-stop job checks above remain valid
evidence for those controls. The final integrated local run used adapter
start/stop on its disposable clone to focus on same-origin console behavior.
