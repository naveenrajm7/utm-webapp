# Local API job journal

## Single origin production runtime

From the repository root, run `npm ci`, `npm run build`, set a nonempty
`UTM_API_KEY`, then run `npm run start:production --workspace=api`. The one Node
process listens on `127.0.0.1:${PORT:-3000}` and serves the Next production
build, `/v1` and legacy REST routes, and console upgrades at `/ws/serial` and
`/ws/vnc`. Open `http://127.0.0.1:3000` (or the configured `PORT`) and enter
the API key in the browser. The web build must be present at `apps/web/.next`;
Next serves its build assets and dynamic console pages directly, including
reloads of `/terminal/<vm UUID>` and `/vnc/<vm UUID>`. No source directory is
mounted as static content. Unknown `/v1` requests return the authenticated
JSON `not_found` shape, and unknown WebSocket upgrade paths return HTTP 404.

The acceptance test hook is `createProductionRuntime(fakeAdapter, options)`
from `apps/api/src/productionRuntime.ts` (or its built `dist` module). It
returns an HTTP server before it listens, so a test can use
`server.listen(0, "127.0.0.1")` and inspect the assigned free port. Pass an
optional `webHandler` to replace Next for an API-only integration test; omit it
to test the actual built UI. Both forms keep the injected adapter and job
journal in the same process. Browser console clients use
`/ws/serial?vmUUID=<UUID>` and `/ws/vnc?vmUUID=<UUID>` on the page origin.
Browser WebSockets authenticate with an encoded `utm-auth` handshake
subprotocol; the API key is not placed in a URL. Production upgrades require an
`Origin` matching that exact loopback listener.
After `npm run build`, `npm run smoke:production --workspace=api` runs the
built Next app and an unsupported-console fake adapter on a free loopback
port. It verifies direct page reloads, a build asset, static isolation,
authenticated REST, and both console upgrades without contacting UTM.

`npm run dev` remains the two-listener local development flow: Next on port
3000 and the API on loopback port 3001.

## Job journal

The local API stores VM operation jobs at
`~/Library/Application Support/UTM Web/api-jobs.json` by default. Set
`UTM_API_JOB_JOURNAL_PATH` to an absolute path outside the repository to move
it. The API takes an exclusive `<journal path>.lock` before reading or writing
the journal. A second API process using the same path fails startup. A clean
shutdown releases the lock; after a crash, startup removes a stale lock only
when its recorded PID no longer exists. An invalid lock requires local
inspection before removal. The API creates
the parent directory with mode `0700` and atomic replacement files with mode
`0600`. The journal contains job IDs, states, small operation results, and
typed errors; it does not store API keys, request bodies, or VM configurations.

Each snapshot is limited to 256 jobs and 1 MiB. When a new job is admitted,
the oldest terminal records are removed as needed; a pruned ID returns the
existing `404 not_found` response. If all 256 records are active, admission
returns `503 service_unavailable`. There is no time based expiry.

Admission writes the queued record to disk before `202` is returned. A write
failure rejects admission with `503 service_unavailable` before a UTM command.
The running record is written before the command. If that write fails, the
command is skipped and the current process reports a failed job. A terminal
write failure makes the current process report `unknown`; the on disk running
record will also recover as `unknown`. An unreadable or invalid journal stops
API startup so existing job history is not silently discarded.

On startup, queued and running jobs become terminal `unknown` records with
`outcome_unknown`. The API does not replay a UTM command. An unknown job does
not hold an operation or name lock forever: the new process checks fresh VM
state, capabilities, and inventory before another mutation and applies its
normal in process conflicts. A UTM command from the interrupted process may
still be finishing outside the API. After an unknown result, wait for VM state
to settle and inspect refreshed inventory and details before attempting
another action, especially clone or delete. The journal provides recovery of
job tracking, not exactly once execution or a cross process UTM lock.

`GET /status` is an unauthenticated liveness check. `GET /ready` is an
unauthenticated readiness check: it returns `200 {"ready":true}` only while
the API owns its journal and a UTM inventory read succeeds. Otherwise it
returns `503 {"ready":false}` without exposing UTM diagnostics. Default
browser origins are `http://localhost:3000` and `http://127.0.0.1:3000` for
REST preflight and WebSockets. Setting `UTM_WEB_ORIGIN` to one local HTTP(S)
origin narrows access to that origin. Other browser origins are denied.
