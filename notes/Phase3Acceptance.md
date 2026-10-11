# Phase 3 local acceptance — 2026-10-11

## Scope and environment

Tested the merged `main` baseline at `fa4918d9c46b55568dff2d235c972ac416fba20e` in worktree `codex/phase3-acceptance` on the Mac running UTM 5.0.6. The API ran at `127.0.0.1:3001`; the browser ran at `http://localhost:3000/` in an isolated headless Google Chrome profile. A fresh random API key was generated for this run and kept outside the repository. The key is not recorded here.

Only the named disposable source `10EC4AB2-91F6-42AB-A3DF-0996C75B80CF` was used. The only VM edited or deleted was clone `D6D4522A-8AD8-439A-AF16-5E30C567F09C`. No power, console, sandbox, or guest-execution mutation was attempted.

## Commands and repository checks

From the worktree root:

```sh
pwd
git status --short --branch
git rev-parse HEAD
git rev-parse main
utmctl version
utmctl list --hide | rg '10EC4AB2-91F6-42AB-A3DF-0996C75B80CF'
npm ci
npm run build
npm run lint
npm test
```

Results: clean `codex/phase3-acceptance`; `HEAD` and local `main` both `fa4918d9c46b55568dff2d235c972ac416fba20e`. `utmctl version` returned `5.0.6`; its filtered list showed the source UUID, expected name `vagrant_test_default_1744595654130_77151`, and `stopped`. `npm ci` succeeded (831 packages added; npm reported 77 audit findings). Build succeeded, 4/4 Turbo tasks. Lint succeeded, 7/7 tasks. Tests succeeded: logger 1, adapter 22, API 35, web 14; 72/72 total. No application code or lockfile was changed.

The local apps were started with the equivalent of:

```sh
umask 077
export UTM_API_KEY="$(openssl rand -hex 32)"
npm run dev
```

The actual key was stored in a mode-restricted file under `/private/tmp` so authenticated checks could reuse it without printing it. `/status` returned HTTP 200. The browser initially loaded at `http://127.0.0.1:3000/`; see the origin defect below. All successful browser flow steps used `http://localhost:3000/`.

## Source gate and HTTP requests

Authenticated requests used `Authorization: Bearer $UTM_API_KEY`. These are the exact methods, paths, and JSON bodies exercised; the `curl` form below is a reproducible equivalent of the Python `urllib.request` and browser requests used in this run. Set `UTM_API_KEY` in the shell before running it. Use a **new unique clone name** on replay, and recheck the source gate first.

```sh
API=http://127.0.0.1:3001
SOURCE=10EC4AB2-91F6-42AB-A3DF-0996C75B80CF
curl -i -H "Authorization: Bearer $UTM_API_KEY" "$API/v1/capabilities"
curl -i -H "Authorization: Bearer $UTM_API_KEY" "$API/v1/vms"
curl -i -H "Authorization: Bearer $UTM_API_KEY" "$API/v1/vms/$SOURCE"
```

Before any mutation, `/v1/capabilities` returned HTTP 200 and UTM `5.0.6` with clone/configure/delete enabled. `/v1/vms` returned HTTP 200 with exactly one source UUID match. `/v1/vms/$SOURCE` returned HTTP 200: expected name, `status: stopped`, `backend: qemu`, `memoryMiB: 4096`, `cpuCores: 0`, and per-VM clone/configure/delete capability `true`. Direct `utmctl list --hide` agreed on source name and stopped state.

The browser selected that source and displayed Clone, Settings, and Delete. Only Clone was submitted against the source. A temporary Chrome DevTools helper captured the browser's request and job responses; the helper was outside the repository. The equivalent requests are:

```sh
CLONE_NAME=phase3-acceptance-20261011-a8efca
curl -i -X POST -H "Authorization: Bearer $UTM_API_KEY" -H 'Content-Type: application/json' \
  --data "{\"name\":\"$CLONE_NAME\"}" "$API/v1/vms/$SOURCE/clone"
curl -i -H "Authorization: Bearer $UTM_API_KEY" \
  "$API/v1/jobs/ae85a0d5-8612-4b7e-a7ce-ff24900e5aed"
```

Browser POST returned HTTP 202, job ID `ae85a0d5-8612-4b7e-a7ce-ff24900e5aed`. Browser/API polling observed `running`, then `succeeded` with `result.vmId: D6D4522A-8AD8-439A-AF16-5E30C567F09C`; `queued` was not sampled. API inventory and detail then returned this new UUID once, with the requested name, `stopped`, `qemu`, 4096 MiB, and 0 core override. The browser added the clone row without a page reload.

The browser selected **that clone UUID** and saved Name = `phase3-acceptance-20261011-a8efca-edited`, RAM = `4352` MiB, CPU cores = `2`:

```sh
CLONE=D6D4522A-8AD8-439A-AF16-5E30C567F09C
EDITED_NAME=phase3-acceptance-20261011-a8efca-edited
curl -i -X PATCH -H "Authorization: Bearer $UTM_API_KEY" -H 'Content-Type: application/json' \
  --data "{\"name\":\"$EDITED_NAME\",\"memoryMiB\":4352,\"cpuCores\":2}" \
  "$API/v1/vms/$CLONE"
curl -i -H "Authorization: Bearer $UTM_API_KEY" \
  "$API/v1/jobs/f6481b92-27d2-4ee3-912c-a8e673a6450d"
```

Browser PATCH returned HTTP 202, job ID `f6481b92-27d2-4ee3-912c-a8e673a6450d`. Polling observed `running`, then `succeeded` with `{vmId: D6D4522A-8AD8-439A-AF16-5E30C567F09C, status: stopped}`. Clone detail readback and the browser selection both showed the edited name; API detail showed 4352 MiB and 2 cores. Source detail still showed its original name, stopped state, 4096 MiB, and 0 core override.

Delete confirmation was checked on the clone before submitting a valid delete:

```sh
curl -i -X DELETE -H "Authorization: Bearer $UTM_API_KEY" -H 'Content-Type: application/json' \
  --data '{"confirmName":"wrong name"}' "$API/v1/vms/$CLONE"
curl -i -X DELETE -H "Authorization: Bearer $UTM_API_KEY" -H 'Content-Type: application/json' \
  --data "{\"confirmName\":\"$EDITED_NAME\"}" "$API/v1/vms/$CLONE"
curl -i -H "Authorization: Bearer $UTM_API_KEY" \
  "$API/v1/jobs/9fd918a4-e9ab-450e-bd9f-bf3ea5753b22"
```

Wrong-name DELETE returned HTTP 409 `{error:{code:"conflict",message:"Confirmation must match the current VM name"}}` and no job. In the browser, Delete was disabled for an empty or wrong confirmation and enabled only after typing the exact edited name. The browser's valid DELETE returned HTTP 202, job ID `9fd918a4-e9ab-450e-bd9f-bf3ea5753b22`. Polling observed `running`, then `succeeded` with `{vmId: D6D4522A-8AD8-439A-AF16-5E30C567F09C, deleted: true}`.

## Refresh and cleanup

After the delete job, the browser removed the clone row and cleared the selection. A browser page reload again showed the source and no clone. The API inventory returned no clone UUID and exactly one source UUID. `GET /v1/vms/D6D4522A-8AD8-439A-AF16-5E30C567F09C` returned HTTP 404. A final filtered `utmctl list --hide` showed the source still stopped under its original name and no clone UUID. The source was never edited, deleted, started, or stopped during this run.

After **all three jobs were terminal**, the API and web dev processes were stopped cleanly and restarted with the same key. This did not interrupt a mutation. Each recorded job ID then returned HTTP 404 `{error:{code:"not_found",message:"Job not found"}}`. The browser inventory still showed the source and no clone. This confirms the current baseline's in-memory job lifetime; it does not test interruption of a running command.

## Defects and handoff

1. **API journal lane — completed jobs disappear after process restart.** Repro: complete any clone/settings/delete job, stop and restart `npm run dev`, then `GET /v1/jobs/<recorded-id>`; all three IDs above returned 404. Implement the durable job contract in `notes/JobRecoveryContract.md`, including startup `unknown` conversion for interrupted admitted jobs and documented storage/retention. Recheck terminal IDs after a clean restart and use fakes for interrupted-job coverage. No live command was interrupted here.
2. **API/web integration — `127.0.0.1:3000` browser origin fails with defaults.** A valid key at `http://127.0.0.1:3000/` left the inventory empty; API preflight `OPTIONS /v1/vms` returned 401. The API defaults its allowed web origin to `http://localhost:3000`, while the browser uses the page hostname for its API URL. `http://localhost:3000/` worked. Align the advertised browser URL and origin handling, then test both loopback hostnames or document one canonical URL.
3. **API error envelope — deleted-VM 404 reveals a local absolute JXA script path.** After deletion, `GET /v1/vms/<clone-UUID>` returned `not_found` but its message included an absolute checkout path ending in `packages/utm-adapter/dist/scripts/utm.jxa.js` and `VM_NOT_FOUND (-2700)`. Return a stable client-facing message without a host filesystem path; preserve diagnostics in local logs if needed.
4. **Web recovery lane — pending-job reload behavior remains unverified live.** The current browser flow passed without a reload during a running job. The merged `VmStore` tracks pending jobs in memory, so the recovery contract's `sessionStorage` metadata, bounded transient retry, and `unknown` handling still need the web lane's implementation and fake tests. After the API and web recovery PRs merge, repeat a disposable-clone browser action with a same-tab reload while its job is pending; confirm the same job ID resumes polling and no second mutation is submitted. Do not crash the API during a live UTM command.

Checks not performed: running-job API crash simulation, live `unknown` outcome, same-tab reload while a mutation was pending, and power/console checks. The first two would require disrupting a live UTM operation and were intentionally skipped; the reload behavior belongs to the recovery implementation and should be covered with fakes before a controlled disposable-clone retest. Power and console were outside this direct-management acceptance scope. After the API and web PRs merge, rerun `npm ci`, `npm run build`, `npm run lint`, `npm test`, then repeat this local browser/API flow on a fresh clone of the same confirmed stopped QEMU source, editing and deleting only that new clone.
