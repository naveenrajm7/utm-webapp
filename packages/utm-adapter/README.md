# UTM adapter

`UtmPort` is the boundary for VM inventory, detail, console target discovery, capability detection, clone, configuration, power control, deletion, and guest execution. Inject `UtmAdapter` into the API or supply a fake `UtmPort` in tests. The adapter launches processes with argument arrays and no shell, validates VM UUIDs and guest arguments, and applies time and output limits. Failures have a stable `UtmError.code` and `operation`.

The adapter uses UTM's fixed scripting interface for structured inventory, VM detail, console discovery, and configuration. It tries `utmctl version` once per adapter instance; if the command is available it uses `utmctl` for clone, power, delete, and guest execution. If the command is unavailable, fixed JXA actions provide those operations. `getSerialDevice(id)` resolves a configured PTY only for a started VM. `getVncTarget(id)` accepts only a configured loopback QEMU `-vnc` argument and also requires a started VM. Both have fake coverage; neither transport has been validated against a running disposable VM. Serial and display capability flags describe configuration and remain true while stopped. Apple displays are not advertised as VNC displays.

Clone, configure, delete, guest execution, and network presets are not advertised as available because they lack live validation. Their methods remain in the port for later disposable-VM verification. `network: "offline"` removes every NIC; `network: "shared"` replaces inherited NICs with one new shared/NAT NIC. Both require a stopped VM. Callers should only allow deletion of clones they own; this port has no ownership database.

## Mac read-only verification (2026-10-10)

- Installed UTM 5.0.6 scripting dictionary exposes VM configuration, PTY serial ports, and both QEMU and Apple serial configurations.
- Adapter `getCapabilities`, `listVms`, and `getVm` succeeded in the Mac GUI session. Inventory contained 30 stopped VMs. Detail calls succeeded for all 30, including QEMU and Apple backends. One stopped QEMU VM had a configured loopback VNC argument; configured PTY serial ports were also observed. These are configuration observations, not proof of a working live transport.
- The restricted sandbox could not reach the UTM app (`Application can't be found`); the same read-only calls passed with the Mac GUI-session permission.
- No named disposable VM was supplied. Live `getSerialDevice`, `getVncTarget`, start, stop, clone, configure, delete, and guest execution remain unverified. To validate with a named disposable VM, start it, call both target methods for its configured consoles, connect to the returned serial path and VNC target, then stop it. Use a disposable clone to separately check clone, configuration, deletion, and guest execution. Never use a personal VM for those checks.

`npm run build --workspace=@repo/utm-adapter`, `npm run lint --workspace=@repo/utm-adapter`, and `npm run test --workspace=@repo/utm-adapter` passed. Jest ran 13 fake/process tests. The integration owner wires API detail and console resolution to this port after both branches merge.
