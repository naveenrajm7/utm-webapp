# Local control plane agent handoff

## Goal and starting point

Build one Mac-hosted backend that controls UTM and serves both the existing web UI and an MCP adapter. This milestone runs locally on one Mac. It should prove a managed sandbox flow using a disposable UTM template: create a clone, boot it, execute in the guest, inspect the result, and destroy only the clone.

The refreshed `main` branch contains API-key protection, POST start and stop routes, VM listing/details, serial WebSocket bridging, and a QEMU VNC bridge. VM operations are still in Express controllers and JXA scripts. The UI on `main` has clone, delete, and configure placeholders. The old work-in-progress UI changes are preserved at local commit `3a6c82b` on branch `codex/web-ui-wip`; the web agent should start from that branch. No agent worktree should be based on the previously dirty checkout.

This handoff replaces the older, archived September note. `AGENTS.md` describes the verified local build and test baseline.

## Shared contract for parallel work

Keep this contract small and stable while agents work independently. The API agent owns HTTP routing, the UTM adapter owns UTM calls, and the sandbox service owns workflow and metadata. The web and MCP agents consume HTTP only. Use the existing `UTM_API_KEY` for local development; browser account login and public exposure are separate milestones.

| Method and path | Purpose | Response |
| --- | --- | --- |
| `GET /v1/capabilities` | UTM version and host features | Capability object |
| `GET /v1/vms` and `GET /v1/vms/:id` | Inventory and per-VM capabilities | VM object or list |
| `POST /v1/vms/:id/start` and `/stop` | Power operation | `{ "jobId": "..." }` |
| `GET /v1/templates` | Approved source VMs for sandboxes | Template list |
| `POST /v1/sandboxes` | Clone an approved template | `{ "sandboxId": "...", "jobId": "..." }` |
| `GET /v1/sandboxes/:id` | Managed clone status and lease | Sandbox object |
| `POST /v1/sandboxes/:id/exec` | Run a guest command | `{ "jobId": "..." }` |
| `DELETE /v1/sandboxes/:id` | Stop and delete a managed clone | `{ "jobId": "..." }` |
| `GET /v1/jobs/:id` | Poll a long operation | State, result, or structured error |

`POST /v1/sandboxes` accepts `{ "templateId": "...", "network": "offline" | "shared", "ttlSeconds": number }`. The service must reject an unapproved template. `offline` means no guest NIC; `shared` means UTM's shared/NAT network. `exec` accepts `{ "argv": string[], "timeoutSeconds"?: number }`; its completed job result contains `stdout`, `stderr`, and `exitCode`. Job states are `queued`, `running`, `succeeded`, and `failed`. Return a typed `unsupported` error for a VM without guest execution support.

VM objects use a stable `id` (UTM UUID), `name`, `status`, `backend`, and explicit capability flags. A conditional snapshot endpoint can be added after the adapter proves it for the installed UTM and VM backend. Do not expose snapshot tools for unsupported VMs. Existing unversioned routes can remain during migration.

## Independent agent assignments

### UTM adapter — `codex/utm-adapter`

Own `packages/utm-adapter/**`. Define an injectable `UtmPort` and implement list, details, clone, configure, start, stop, delete, guest execution, and capability detection. Prefer `utmctl` for supported operations but retain a fixed-script JXA path where needed. Use `execFile` or `spawn` with argument arrays, timeouts, bounded output, and typed errors. Test parsing and errors with fakes. Live validation uses only a named disposable template or its clone. Do not edit `apps/api` or `apps/web`.

**Done:** a test demonstrates clone → start → guest exec → stop → delete through the port with a fake adapter, and a Mac smoke-test report identifies which calls were actually verified with UTM.

### API foundation — `codex/api-foundation`

Own `apps/api/**`. First remove shell-string execution for VM details and validate every VM ID; bind the server to loopback by default; constrain WebSocket paths and inputs. Add `/v1` handlers against injected port and sandbox interfaces with fakes in tests. Keep current unversioned routes working for the existing UI during migration. Do not put UTM commands or sandbox workflow in controllers. Do not edit `packages/utm-adapter` or `packages/sandbox-service`.

**Done:** an invalid or malicious VM ID returns a client error without launching a process; API tests cover auth, routing, error shapes, and one asynchronous job response.

### Sandbox service — `codex/sandbox-service`

Own `packages/sandbox-service/**`. Build the managed clone lifecycle against an injected `UtmPort`. Maintain approved templates, ownership metadata, jobs, and TTL leases in SQLite. Support `offline` and `shared` network presets. A destroy request must verify that the VM is a managed clone created by this service. Reconcile unfinished jobs and leases after restart. Test with a fake UTM port. Do not add HTTP routes or MCP tools here.

**Done:** tests cover successful create/execute/destroy, guest-agent absence, failed clone cleanup, expired lease cleanup, restart reconciliation, and rejection of deletion of an existing personal VM.

### MCP adapter — `codex/mcp`

Own `apps/mcp/**`. Build a stdio MCP server that calls the `/v1` API using a configured local URL and API credential. Expose list VMs, list templates, create sandbox, run command, get job, and destroy sandbox. Return structured job and capability errors. It must contain no direct UTM or Apple scripting code. Test it with a fake HTTP server.

**Done:** a local MCP client can complete the sandbox flow through the API once integration lands; all tool calls are covered by fake-server tests.

### Web UI — `codex/web-ui-wip`

Own `apps/web/**`. Start from the preserved UI branch, not from a fresh `main` checkout. Keep the existing responsive layout, polling, error states, VNC viewer, and serial console changes. Change data access to the `/v1` contract, show capability-based actions, and add a template-to-sandbox flow. Avoid claiming that every UTM VM has a browser display. Do not edit API or core packages.

**Done:** the web build passes; with a mocked API, users can list VMs, start/stop, create a sandbox from an approved template, see job status, and destroy the sandbox.

## Prepared worktrees and merge procedure

The following local worktrees are ready. Open the corresponding directory for each agent; do not run `git worktree add` again in this checkout. Run `npm ci` inside a worktree before building or testing because dependencies are not copied from the primary checkout.

| Agent | Branch | Worktree |
| --- | --- | --- |
| UTM adapter | `codex/utm-adapter` | `../utm-webapp-utm-adapter` |
| API foundation | `codex/api-foundation` | `../utm-webapp-api-foundation` |
| Sandbox service | `codex/sandbox-service` | `../utm-webapp-sandbox-service` |
| MCP adapter | `codex/mcp` | `../utm-webapp-mcp` |
| Web UI | `codex/web-ui-wip` | `../utm-webapp-web-ui` |

These branches and handoff commits are local and have not been pushed. Agents working on another Mac need the branches published or otherwise transferred before they can use these worktrees.

Each agent commits only its owned files and records tests run and Mac-only checks still needed. Merge the adapter and API foundation first, then the sandbox service, MCP adapter, and web UI. The integration owner resolves `package-lock.json` once, wires the packages into the API, checks the legacy UI migration, and runs the full disposable-VM flow on the Mac. Do not run destructive checks against personal VMs.

This milestone ends when the browser and MCP client both use the same API and an approved template can be cloned, executed in, and destroyed locally. Packaging and remote access are outside this milestone.
