# UTM Web agent instructions

## Product and current code

This repository is a local Mac control plane for UTM. The immediate goal is one UTM adapter behind the REST and WebSocket API, used by the browser UI. Read notes/AgentHandoff.md before implementing the next milestone.

The npm-workspace monorepo currently has two running apps and one UTM package:

| Path | Role |
| --- | --- |
| apps/web | Next.js 14 browser UI on port 3000 |
| apps/api | Express REST and WebSocket API on port 3001 |
| packages/utm-adapter | Injectable UTM process and JXA boundary |

The merged main branch has authenticated /v1 VM inventory, details, power jobs, direct clone/edit/delete jobs, and a browser UI that consumes those routes. The adapter's clone/edit/delete path was live-validated on UTM 5.0.6 with a disposable QEMU clone. The combined API and browser management flow still needs live acceptance. Legacy REST routes and console target discovery use the same adapter instance as `/v1`. Sandbox routes exist as interfaces but return service_unavailable in the running API; MCP and sandbox integration is paused.

## Local development and verification

On the Mac running UTM, set UTM_API_KEY to a random secret and run npm run dev. The API listens on 127.0.0.1:3001 by default. The web app is intended for use on the same Mac during this milestone.

API Supertest tests require permission to bind a local socket; an EPERM from a restricted sandbox is not a code failure. The named disposable VM `vagrant_test_default_1744595654130_77151` was used for live power, serial, and VNC checks on UTM 5.0.6 and as the source for adapter clone/edit/delete validation. Only newly created disposable clones were edited and deleted. Guest execution remains paused. No personal VM may be used for destructive or experimental checks.

## Current work boundaries

- Start every new lane from current main in a new branch and worktree. The phase 1 and phase 2 branches have merged; do not reuse their worktrees.
- The active milestone is local VM control and the web app. Sandbox orchestration, guest execution, MCP, packaging, and remote access are paused.
- Follow the current job wire format and file ownership in notes/JobRecoveryContract.md. notes/AgentHandoff.md and notes/DirectVmManagementContract.md document earlier waves. The integration owner resolves package-lock.json conflicts.
- Only the acceptance lane runs live UTM mutations during the next parallel wave; API and web lanes use fakes. The acceptance lane owns local ports 3000/3001 during its run.
- Run read-only checks against existing VMs. Start, stop, clone, configure, delete, and console tests require a named disposable test VM or clone. If none is supplied, use fakes and report the live validation gap.
- Do not expose a capability in the API or UI merely because a method exists in code. Verify that the installed UTM build and VM backend support it.
