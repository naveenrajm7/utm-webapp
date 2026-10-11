# Local VM job recovery contract

Shared baseline for the three parallel lanes starting 2026-10-11. This wave
closes the local direct-VM management acceptance gap and improves job recovery.
It does not add sandbox, MCP, guest execution, packaging, or remote access.
The existing authenticated `/v1` VM and job routes remain compatible.

## Job wire format

All existing mutating `/v1/vms` routes continue to return
`202 {"jobId":"<id>"}`. `GET /v1/jobs/:jobId` keeps `{id,state,result?,error?}`.
The state union becomes `queued | running | succeeded | failed | unknown`.
`result` appears only for `succeeded`; `error` appears for `failed` or
`unknown`. Existing success results and typed failures are unchanged.

`unknown` is terminal for job tracking: the API was interrupted before it
could prove success or failure. It does **not** mean the UTM operation failed.
Return the same job ID with `error.code: "outcome_unknown"` and a message to
inspect refreshed VM state before another action. A genuinely absent or
expired job ID still returns `404 not_found` with the existing error envelope.

Accepted job IDs and terminal results survive an API process restart. Persist
an admitted job before returning 202, persist `running` before issuing the
UTM command, and persist its terminal result after readback/reconciliation.
On startup, convert persisted `queued` or `running` jobs to `unknown`; never
replay them automatically. If admission cannot be persisted, reject before
issuing a UTM command. Keep the journal bounded, outside the repository, and
free of API keys and full VM configurations. The API PR documents its storage
path, retention policy, and failure behavior.

The API still rechecks fresh VM state and capabilities before each new
mutation. An `unknown` record alone cannot prove that an external UTM command
has stopped; the API PR must document this residual risk and its conflict
handling. Do not describe persistence as exactly-once execution.

## API operation safety

The shared operation lock keys VM UUIDs in canonical lowercase form,
including legacy and `/v1` routes. Requests for the same UUID with different
hex casing must conflict. Reserve desired names across concurrent clone and
rename jobs. Keep existing admission errors, capability and stopped-state
checks, and clone/delete inventory reconciliation. No new mutation or history
endpoint is required this wave.

## Browser recovery

Keep only `{jobId, vmId, action}` as pending-job metadata in `sessionStorage`
so a reload of the same tab can resume polling after authentication. Do not
store the API key in that record. Clear it after confirmed success or failure.
On `unknown` or 404, refresh inventory and selected VM details, show that the
outcome must be checked, and do not submit the action again. Retry transient
transport failures and 5xx responses with a bounded delay while retaining
the pending ID. A reload must not create a second clone or delete. Keep the
static demo on the same wire shape.

## Parallel ownership and acceptance

| Lane | Owned paths | Deliverable |
| --- | --- | --- |
| Local acceptance | `notes/Phase3Acceptance.md` and optional read-only `tools/` check | Test the merged baseline through the real local API and browser; record exact requests, job results, UI observations, clone cleanup, and open defects. Do not edit app code. |
| API safety and journal | `apps/api/**` | Canonical locks, name reservation, durable jobs, `unknown` recovery, fake restart/race tests. |
| Web recovery | `apps/web/**` | Session reload recovery, transient retry, `unknown`/404 handling, interactive tests and demo parity. |

Only the acceptance lane runs live UTM mutations while these branches are in
progress. The named disposable source is
`vagrant_test_default_1744595654130_77151`
(`10EC4AB2-91F6-42AB-A3DF-0996C75B80CF`); confirm its current identity and
stopped state before use. Clone it with a unique name. Edit and delete only
the clone, never the source or a personal VM. If a live step is unavailable,
record the precise gap and leave the source unchanged. The acceptance lane
owns local ports 3000/3001 during its run; other lanes use fakes or separate
ports. After all PRs merge, rerun the integrated browser flow and full checks.
