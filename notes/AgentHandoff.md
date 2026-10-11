# Local VM control and web handoff

## Phase 1 integration update (2026-10-10)

PRs #10 (adapter), #11 (API), and #12 (web) are merged. The integration branch
connects `/v1`, legacy REST routes, power jobs, and serial/VNC WebSockets to
one adapter instance and removes the API's duplicate JXA runtime paths. The
sections below preserve the original assignment and acceptance plan. Sandbox,
MCP, clone, configure, delete, and guest execution remain outside the live
web flow; assess them separately before enabling them.


## Decision and current state (2026-10-10)

Focus on a working local UTM Web flow: one UTM adapter, one REST/WebSocket backend, and the browser UI. Managed sandboxes, guest execution, MCP, DMG packaging, and remote access are paused. The adapter, API foundation, and web UI branches were merged into main as PRs #6, #9, and #8. Start new work from main, not from those merged branches.

| Layer | Working now | Gap for this milestone |
| --- | --- | --- |
| UTM adapter | Injectable port, structured inventory, details by UUID, power calls, typed errors, fake tests | Existing API still has independent JXA paths; read-only live UTM checks passed, mutating and console operations need a disposable VM |
| API | Authenticated /v1 capabilities, list, details, start/stop jobs, and job polling | Legacy routes and console discovery still bypass the adapter; power jobs are process memory only |
| Web | /v1 inventory, detail, power controls, error states, VNC and serial components | Detail capabilities can go stale after a power change; list responses do not carry console availability; live console flow is unverified |
| Deferred | Sandbox and MCP code exists on separate branches; placeholder routes/components remain | No sandbox service or MCP server is wired into the running app |

Build, lint, and tests passed on main at review: 9 adapter tests, 19 API tests, 3 web tests. Read-only UTM 5.0.6 inventory and one stopped QEMU VM detail response worked. No disposable running VM was available for a live console or power check. These observations establish read-only connectivity, not proof of mutating operations.

## Contract for the next parallel wave

Keep the current authenticated /v1 endpoints stable: GET /capabilities, GET /vms, GET /vms/:id, POST /vms/:id/start, POST /vms/:id/stop, and GET /jobs/:id. Start and stop return HTTP 202 with a jobId. Jobs report queued, running, succeeded, or failed with a typed error. The UI must treat a lost job after API restart as unknown and refresh actual VM state.

Each VM in both list and detail responses has the same stable id, name, status, backend, and capability semantics. A serial or display capability means the VM is configured for that console, even while stopped; opening the transport still requires an appropriate running state. A transient failure to obtain a VNC port while stopped must not erase a configured display capability. Show only capabilities actually supported by that VM/backend on the installed UTM build.

The API owns authentication, HTTP, jobs, and WebSocket bridging. The adapter owns every UTM-specific query or command, including console endpoint discovery. Proposed adapter methods are getSerialDevice(id): Promise<string> and getVncTarget(id): Promise<{ host: string; port: number }>, alongside an enriched getVm(id). The API agent may define an injectable console resolver against this shape while the adapter agent implements it. The integration owner wires the concrete adapter after both branches merge. Keep browser clients dependent on REST/WebSocket only.

Do not add direct clone/configure/delete UI or REST routes in this wave. The adapter has methods for them, but they have only fake-test coverage and delete has no ownership guard. Sandbox, guest execution, and MCP routes remain unconnected and the sandbox UI stays hidden.

## Three agents to run in parallel

### 1. Adapter and capabilities — codex/phase1-adapter

Own packages/utm-adapter/**. Move VM detail and console target discovery into the adapter using fixed, bounded JXA/process calls. Extend the Vm type with detail fields and explicit serial/display capabilities whose meaning does not change merely because the VM is stopped. Implement the proposed target methods and preserve the existing power interface. Replace optimistic host capability flags for unverified clone, configure, and guest execution with evidence-based availability. Add fake tests for QEMU, Apple backend, stopped/running states, missing console, and malformed UTM output. Perform read-only Mac checks; use a named disposable VM for live start/stop or console validation only if one is supplied.

Done when adapter build/lint/tests pass, read-only inventory/detail/target behavior is documented, and unsupported capabilities are not advertised. Report every live action that remains unverified.

### 2. API convergence — codex/phase1-api

Own apps/api/**. Route legacy VM inventory/details/power through injected adapter-backed services so there is one VM control path. Keep legacy URLs as compatibility shims while the web uses /v1. Introduce an injectable console resolver for WebSocket bridging; retain a working legacy-backed default until integration swaps in the adapter methods. Keep UUID validation, local loopback binding, API-key auth, and typed /v1 errors. Restrict CORS to the configured local web origin and verify WebSocket origin/path/input handling. Add tests for identical legacy and /v1 VM state, unavailable console targets, power conflicts, and a job lost on restart.

Done when API build/lint/tests pass independently, no legacy controller invokes its own UTM command, and the remaining console adapter wiring is clearly isolated for integration.

### 3. Web end-to-end VM flow — codex/phase1-web

Own apps/web/**. Keep the existing layout. Remove sandbox claims from visible copy while its backend is paused. Refresh selected VM details/capabilities after power transitions and when inventory status changes; make header buttons and tabs use the same current VM data. Show configured display/serial affordances when stopped but gate opening until running. Handle job polling failures by refreshing VM state and showing a recoverable message. Add meaningful UI tests with a fake /v1 API for stopped -> running -> console-ready, API restart during a job, and unsupported consoles.

Done when web build/lint/tests pass and the UI does not promise a console or sandbox it cannot open.

## Integration gate and following wave

After those three branches land, an integration owner wires the API console resolver and detail mapping to the adapter, removes redundant JXA code, resolves package-lock.json if needed, and runs the full builds/tests. With a named disposable VM, verify browser list -> detail -> start -> job completion -> supported console -> stop on the Mac. Do not run mutating tests against personal VMs. If no disposable VM is available, record the live-flow gate as open.

Only after that gate, plan direct VM management as the next wave: validate adapter clone/configure/delete on a disposable clone, expose typed asynchronous /v1 operations with explicit destructive confirmation, then add matching web controls. VM creation and snapshots require separate capability research and validation. Sandbox and MCP remain paused until guest execution reliability and VM ownership rules are proven.

## Prepared worktrees and PR handoff

These worktrees already exist at the same local main baseline. Do not create them again. The old agent worktrees remain attached to already merged branches.

| Lane | Branch | Worktree |
| --- | --- | --- |
| Adapter | codex/phase1-adapter | ../utm-webapp-phase1-adapter |
| API | codex/phase1-api | ../utm-webapp-phase1-api |
| Web | codex/phase1-web | ../utm-webapp-phase1-web |

Open each target worktree as that agent's writable workspace. Run npm ci there. Each agent commits only its owned paths, pushes its branch, and opens a PR targeting main. The PR description must list code changes, exact build/lint/test commands and results, Mac/UTM checks performed, and every check that could not be run with its reason and concrete follow-up steps for another agent. Leave cross-lane package-lock.json conflict resolution to integration. A named disposable VM is required before any live mutating or console check.
