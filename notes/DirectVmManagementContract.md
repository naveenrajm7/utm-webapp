# Direct VM management contract

Agreed baseline for the next three worktree lanes (2026-10-10). This is a local
UTM Web feature. Sandbox, MCP, guest execution, packaging, and remote access
remain paused. The API and browser must use the single `UtmAdapter` instance.

## UTM mapping and scope

| Operation | UTM 5.0.6 operation | Adapter contract |
| --- | --- | --- |
| Clone | `utmctl clone <source-UUID> --name <name>`; JXA fallback `duplicate vm with properties {configuration:{name}}` | `cloneVm(sourceId, name): Promise<Vm>`; source stopped; return the new UUID after inventory reconciliation |
| Edit | No `utmctl configure`; JXA `update configuration of vm with {name?, memory?, cpuCores?}` | `configureVm(id, patch): Promise<Vm>`; target stopped; return refreshed VM |
| Delete | `utmctl delete <UUID>`; JXA fallback `delete vm`; UTM itself gives no confirmation | `deleteVm(id): Promise<void>`; target stopped; API requires exact-name confirmation |
| Stop (existing) | `utmctl stop <UUID> --force`; JXA default stop is force | Existing `/stop` is a **force stop**. Label it accurately in the UI. Guest-requested shutdown is a separate future operation. |

Always address VMs by UUID at the UTM boundary. CLI arguments and JXA values are
separate argv/data values, never shell text. Match the installed UTM command
syntax; the current clone CLI argument order should be checked against `utmctl
help clone`. No mutation of an existing personal VM is part of validation.

The first edit surface contains only `name`, `memoryMiB`, and `cpuCores`.
`memoryMiB` maps to UTM scripting `memory` (MiB); `cpuCores` maps to `cpuCores`
(0 means host default). Reuse adapter validation: trimmed, printable name of
1–100 characters; integer memory 128–1,048,576 MiB; integer cores 0–256.
Reject an empty patch, unknown keys, nulls, and incorrectly typed values.

Do **not** accept `network` in this wave's REST edit route. In UTM scripting,
supplying `networkInterfaces` replaces the whole NIC list: the adapter's current
`offline` preset removes all NICs, while `shared` creates a new shared NIC and
can change its MAC. Keep `networkPresets: []` and hide network editing until a
separate explicit replacement contract and disposable-VM validation exist.

## Authenticated `/v1` HTTP contract

Existing inventory, detail, power, console, and job routes remain compatible.
Requests have JSON object bodies; responses use the existing typed error
envelope `{ "error": { "code": "...", "message": "..." } }`.

| Request | Body | Success |
| --- | --- | --- |
| `POST /v1/vms/:id/clone` | `{ "name": "Copy name" }` | `202 { "jobId": "<opaque-id>" }` |
| `PATCH /v1/vms/:id` | Nonempty subset of `{ "name": string, "memoryMiB": integer, "cpuCores": integer }` | `202 { "jobId": "<opaque-id>" }` |
| `DELETE /v1/vms/:id` | `{ "confirmName": "Exact current VM name" }` | `202 { "jobId": "<opaque-id>" }` |

`:id` is always a UUID. Clone name must not match an existing VM name or an
active clone reservation. The delete confirmation is case-sensitive and must
match the current VM name exactly; check it at admission and again immediately
before invoking UTM. The browser requires the user to type the name. Never
log the API key or full VM configuration. Require the same API-key auth and
loopback/CORS rules as existing `/v1` routes.

All three routes use the existing `GET /v1/jobs/:jobId` envelope:
`{id, state, result?, error?}` with `queued | running | succeeded | failed`.
Success results are respectively `{vmId: <new UUID>}`, `{vmId: <target UUID>,
status: "stopped"}`, and `{vmId: <deleted UUID>, deleted: true}`. A job
becomes successful only after UTM state is reconciled (clone appears, edit is
read back, or deleted UUID is absent). Do not retry a clone or delete blindly
after a timeout or lost job; refresh inventory first. Jobs remain in memory in
this wave; a 404 after API restart means unknown outcome, so the browser
refreshes inventory and asks the user to check before retrying.

Use the current error codes: `400 invalid_input` for malformed bodies,
`404 not_found` for unknown VM/job, `409 conflict` for a state or confirmation
mismatch or competing operation, `422 unsupported` when a capability is false,
and `503 unavailable` when UTM is unavailable. Do not create a job when
admission fails. The same per-VM operation lock must cover legacy and `/v1`
power jobs plus clone, edit, and delete. Clone also reserves its desired name
across source VMs. Recheck state inside the job before calling the adapter.
For a supported operation on a running/transitioning VM, return `409 conflict`
for its state before considering the stopped-state capability flag; reserve
`422 unsupported` for an unvalidated UTM build/backend or unavailable feature.

## Capability contract

`GET /v1/capabilities` keeps `{utmVersion, features}` and adds
`features.delete: boolean` beside existing `features.clone` and
`features.configure`. Host flags mean the installed UTM build has a validated
operation path for at least one backend. The per-VM flags on **both**
`GET /v1/vms` and `GET /v1/vms/:id` are authoritative for UI actions:

```json
{
  "capabilities": {
    "clone": false,
    "configure": false,
    "delete": false,
    "start": true,
    "stop": false,
    "serial": true,
    "display": true,
    "guestExec": false,
    "networkPresets": []
  }
}
```

Clone, configure, and delete are true only when the installed UTM version,
the VM backend, and the VM's current stopped state have been validated for
that operation. `backend: "unavailable"` always disables them. A method's
existence, `utmctl --help`, or scripting dictionary support alone is not live
validation. If no disposable VM is available to prove an operation, its flag
stays false; API routes may exist but return `422 unsupported` in the running
app. Keep `guestExec: false` and `networkPresets: []` in this wave. A failed
runtime call still becomes a typed error even when a capability was true.

## Parallel ownership and integration

- **Adapter:** `packages/utm-adapter/**`. Implement the UTM mapping, capability
  evidence, validation, and fake tests. Live mutations only on a named,
  confirmed disposable VM or a clone of it; never edit/delete the source.
- **API:** `apps/api/**`. Implement these exact routes, validation, one shared
  operation lock and job semantics, capability mapping, and fake integration
  tests. Routes may be built against fakes while live flags remain false.
- **Web:** `apps/web/**`. Implement controls and progress/error recovery against
  this contract, including the static demo mock. Show only supported actions.

Each lane owns only its directory; the integration owner resolves shared
`package-lock.json` changes. After PRs merge, run full build/lint/tests and
the final browser flow. Live clone/edit/delete checks require a named
disposable source and clone; if unavailable, report the open validation gate.

Sources: installed UTM 5.0.6 `utmctl help clone|delete|stop` and `sdef
/Applications/UTM.app`; [UTM scripting reference](https://docs.getutm.app/scripting/reference/),
[UTM scripting cheat sheet](https://docs.getutm.app/scripting/cheat-sheet/).
