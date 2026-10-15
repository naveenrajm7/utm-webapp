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
6. Stop only the disposable VM through the browser. Record the POST path, job
   ID, terminal job result, and stopped state in browser, API, and
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

A read-only `utmctl list --hide` on 2026-10-15 confirmed the historical
disposable source still had its exact UUID/name and was stopped. It emitted
two `OSStatus error -10004` event messages before exiting successfully.
No live start/stop or serial/VNC check was run. The one-origin suite must be
repeated on this branch after PR #27 lands on `main`, and the final Actions
result must be recorded in the pull request.
