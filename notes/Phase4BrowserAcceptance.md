# Phase 4 browser acceptance

## Repeatable fake-backed suite

From the repository root, run:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:browser
```

`test:browser` starts the production Next.js build on `localhost:3000`, a
deterministic fake `/v1` API on `127.0.0.1:3001`, and an isolated headless
Google Chrome profile. The suite fails if either port is unavailable. Set
`CHROME_PATH` to another Chrome executable if needed. It uses Node's built-in
test runner and DevTools protocol, so it adds no package dependency or
lockfile change. The fake records mutations and completes jobs only when the
test directs it to. No request reaches UTM.

The browser checks API-key unlock, rejection and relock, inventory and detail
readback, start/force-stop jobs, clone/settings/delete request bodies and
confirmation, same-tab reload during clone and delete jobs, preservation of a
single job ID without duplicate mutation, terminal `unknown` and missing-job
404 outcomes, and stopped/unsupported/connected/disconnected serial-console
states. The live VNC handshake is outside this fake suite; its stopped display
gate and disabled launch control are checked.

## Baseline results (2026-10-14)

Branch `codex/phase4-web-acceptance` started at `8724b48`, before the phase 4
API and web PRs. The test machine has Node 23.4.0, npm 10.9.2, Chrome
155.0.8059.40, and UTM 5.0.6. `npm ci` installed 831 packages. `npm run build`
passed 4/4 tasks; `npm run lint` passed 7/7; `npm test` passed 4/4 tasks
(logger 1, adapter 22, API 42, web 22 tests). `npm run test:browser` passed
all six browser cases (7/7 Node test results, including the parent test).
The first expanded run exposed a test-harness cleanup race after its
assertions passed; the Chrome process is now awaited before its temporary
profile is removed. The final run exited successfully.

The read-only `utmctl list --hide` check showed the named disposable source
`vagrant_test_default_1744595654130_77151`
(`10EC4AB2-91F6-42AB-A3DF-0996C75B80CF`) stopped. UTM emitted two
`OSStatus error -10004` event messages before listing VMs. No live mutation
was attempted in this lane before the phase 4 API and web changes merged.

## Integrated smoke after phase 4 merges

The phase 4 API reliability and web console PRs were not open at the baseline
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
