# Phase 4 browser acceptance

For the configurable-port pull request gate and the separate manual live
checklist, see [Phase5CiAcceptance.md](Phase5CiAcceptance.md).

## Repeatable fake-backed suite

From the repository root, run:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:browser
```

`test:browser` builds and starts the production Next.js app, a deterministic
fake `/v1` API, and an isolated headless Google Chrome profile. It chooses
available loopback ports, or accepts `BROWSER_WEB_PORT` and
`BROWSER_API_PORT` when explicit ports are needed. Set `CHROME_PATH` to
another Chrome executable if needed. It uses Node's built-in test runner and
DevTools protocol, so it adds no package dependency or lockfile change. The
fake records mutations and completes jobs only when the test directs it to.
No request reaches UTM. The Phase 5 addition also exercises the injectable
production one-origin runtime when that runtime is present.

The browser checks API-key unlock, rejection and relock, inventory and detail
readback, start/force-stop jobs, clone/settings/delete request bodies and
confirmation, same-tab reload during clone and delete jobs, preservation of a
single job ID without duplicate mutation, terminal `unknown` and missing-job
404 outcomes, retry after a transient 503 job poll, and
stopped/unsupported/connected/disconnected/reconnected serial-console states,
direct console page reloads, unsupported display, and a fake VNC WebSocket
upgrade. The live VNC handshake remains a separate manual check; the stopped
display gate and disabled launch control are also checked.

## Baseline results (2026-10-14)

Branch `codex/phase4-web-acceptance` started at `8724b48`, before the phase 4
API and web PRs. The test machine has Node 23.4.0, npm 10.9.2, Chrome
155.0.8059.40, and UTM 5.0.6. `npm ci` installed 831 packages. `npm run build`
passed 4/4 tasks; `npm run lint` passed 7/7; `npm test` passed 4/4 tasks
(logger 1, adapter 22, API 42, web 22 tests). `npm run test:browser` passed
all seven browser cases (8/8 Node test results, including the parent test).
The first expanded run exposed a test-harness cleanup race after its
assertions passed; the Chrome process is now awaited before its temporary
profile is removed. The final run exited successfully.

The read-only `utmctl list --hide` check showed the named disposable source
`vagrant_test_default_1744595654130_77151`
(`10EC4AB2-91F6-42AB-A3DF-0996C75B80CF`) stopped. UTM emitted two
`OSStatus error -10004` event messages before listing VMs. No live mutation
was attempted in this lane before the phase 4 API and web changes merged.

## Integrated smoke after phase 4 merges

The phase 4 API reliability and web console PRs were open at the baseline
check. Once both are merged, update this branch from `origin/main`, repeat the
five commands above, then run the API and browser with a fresh random
`UTM_API_KEY` on reserved ports 3001 and 3000. Use `http://localhost:3000`.
Confirm `/v1/capabilities`, `/v1/vms`, and `/v1/vms/<source-UUID>` agree with a
fresh `utmctl list --hide` and that the source still has its exact name,
UUID, stopped state, and supported capabilities. Stop if that gate fails.

With a **new uniquely named clone** of that source, use the browser to submit
one clone, reload the same tab while its job is running, and verify the browser
polls the original job ID and the API records only one clone request. Edit
only the clone's name, RAM, and CPU; read back its details. Exercise supported
power and console controls only on the clone, stop it, then type the exact
clone name to delete it. Confirm the clone is absent in browser inventory,
API inventory, and `utmctl list --hide`, and that the source remains stopped
and unchanged. Capture HTTP paths, job IDs and terminal results, browser
observations, and cleanup in this note. Use a synthetic queued journal record
after all live jobs finish to test `unknown`; never interrupt a live UTM
mutation to create it.

If a source capability is absent, a console endpoint is unavailable, or a
phase 4 PR has not merged, record that exact check and its observed API/UI
state here. Do not use another VM for mutating checks without verifying it is
a named disposable VM or clone.

## Integrated verification (2026-10-14)

After PR #23 (`ddbd31d`) and PR #25 (`fd36b20`) merged, this branch merged
`origin/main` and ran `npm run build` (4/4 tasks), `npm run lint` (7/7),
`npm run test` (102 tests: logger 1, adapter 22, API 48, web 31), and
`npm run test:browser` (all seven scenarios, 8/8 Node test results). All
commands exited successfully. The browser suite used its deterministic fake
API; the following run used UTM 5.0.6 and the production API/UI.

With a fresh random API key and journal on ports 3001/3000, authenticated
inventory and detail reads showed the designated source
`10EC4AB2-91F6-42AB-A3DF-0996C75B80CF` stopped, QEMU, 4096 MiB, with
serial supported and display unsupported. The browser sent one
`POST /v1/vms/<source-UUID>/clone` for `codex-pr24-reload-1792008047682`.
During the running clone job `458f486a-1354-46b7-9e36-31926bfce21e`, the
same tab reloaded, retained that job ID, and resumed polling without a second
clone POST. The job succeeded with clone
`92163828-277F-4A71-BEA3-B0B1AC1C84B4`; the browser then cleared its
pending-job record and showed the clone.

The browser saved clone settings through `PATCH /v1/vms/<clone-UUID>`;
job `68b1fabf-7e94-41d6-a598-77229a377740` succeeded. UTM readback
confirmed the name `codex-pr24-reload-1792008047682-edited`, 3584 MiB RAM,
and one CPU core. The Delete dialog remained disabled until the exact current
name was entered. `DELETE /v1/vms/<clone-UUID>` job
`eed4b6b0-0b6b-4618-99a8-36853dfa7e1c` succeeded; browser, API, and
`utmctl list --hide` inventories no longer showed the clone, and the browser
cleared its pending job. After all live mutations ended, a synthetic queued
journal record `649647fd-e158-4a0f-a852-6e77f529a326` recovered as
`unknown` with `outcome_unknown`; the browser retained its job ID for review.
The original VM remained stopped with its name, 4096 MiB RAM, and automatic
CPU setting unchanged. `utmctl list --hide` emitted two `OSStatus error -10004`
events, then exited 0 with a complete inventory.

The PR #25 live run on a separate uniquely named clone verified dialog
keyboard behavior, real serial connection loss and recovery after an API
restart, and the stopped-VM console gate after a state refresh. The source
and clone report `display: false`, so the VNC route correctly showed its
unsupported-display gate; a live VNC protocol handshake was unavailable with
this designated source. That test clone was also stopped and deleted, and the
source remained unchanged.
