# Local API job journal

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
