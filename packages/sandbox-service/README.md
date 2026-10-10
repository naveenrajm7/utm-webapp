# Sandbox service

SQLite-backed lifecycle for disposable UTM clones. This package has no HTTP routes or UTM process calls. Pass an object implementing `UtmPort` to `new SandboxService({ dbPath, port })`; the interface is structurally compatible with `@repo/utm-adapter`'s port. Use a persistent database path owned by the local backend.

Requires Node 22.13 or newer for unflagged `node:sqlite`. Initialize with `await service.start()` before serving requests and call `await service.close()` on orderly shutdown. `start()` marks interrupted jobs failed, retries deletion of recorded clones left in creation or destruction, and starts the lease sweep. Run one service instance per database.

An administrator must explicitly call `approveTemplate(vmId)` for each disposable source VM; approvals persist in SQLite. `revokeTemplate` prevents future clones without touching existing sandboxes. The HTTP integration can expose only `listTemplates()` and load approvals from local configuration. `createSandbox({ templateId, network, ttlSeconds })` accepts `offline` (no NIC) or `shared` (UTM NAT), with a lease of 1–86,400 seconds. The caller receives a job ID immediately, then polls `getJob()`. Guest execution accepts `argv` and an optional 1–300 second timeout. A completed execution job contains `stdout`, `stderr`, and `exitCode`.

The adapter's `cloneVm` must return a new VM UUID. Before cloning, the service records existing VM IDs; it refuses to adopt a returned ID that already existed. It records the new ID in SQLite before configuration or boot. Deletion checks that record and never uses a requested VM ID directly. If setup fails, it cleans the recorded clone; failed cleanup retains its ownership record for restart recovery. A process crash after UTM creates a clone but before `cloneVm` returns its ID can leave an untracked clone. The service leaves that VM untouched for manual inspection because it cannot prove ownership.

The integration owner should add this package to the API dependencies and refresh the root `package-lock.json` during merge. No live VM operations were used by this package's tests.
