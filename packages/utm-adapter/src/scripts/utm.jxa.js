// Fixed JXA entrypoints. All values are data passed as separate osascript argv entries.
function run(argv) {
  const action = argv[0];
  const utm = Application("UTM");
  const find = function (id) {
    const vm = utm.virtualMachines().find(function (candidate) { return candidate.id() === id; });
    if (!vm) throw new Error("VM_NOT_FOUND");
    return vm;
  };
  if (action === "list") {
    let version = null;
    try { version = utm.UTMVersion(); } catch (_) { /* older UTM */ }
    return JSON.stringify({
      version: version,
      vms: utm.virtualMachines().map(function (vm) {
        const config = vm.configuration();
        return {
          id: vm.id(), name: vm.name(), status: vm.status(), backend: vm.backend(),
          memoryMiB: config.memory, cpuCores: config.cpuCores,
          networkInterfaces: (config.networkInterfaces || []).map(function (nic) {
            return { mode: nic.mode };
          })
        };
      })
    });
  }
  if (action === "start") {
    utm.start(find(argv[1]));
    return JSON.stringify({ ok: true });
  }
  if (action === "stop") {
    utm.stop(find(argv[1]));
    return JSON.stringify({ ok: true });
  }
  if (action === "clone") {
    utm.duplicate(find(argv[1]), { withProperties: { configuration: { name: argv[2] } } });
    return JSON.stringify({ ok: true });
  }
  if (action === "delete") {
    utm.delete(find(argv[1]));
    return JSON.stringify({ ok: true });
  }
  if (action === "exec") {
    const vm = find(argv[1]);
    const cmd = JSON.parse(argv[2]);
    const process = vm.executeAt(cmd[0], {
      withArguments: cmd.slice(1), withEnvironment: [], usingInput: "",
      base64Encoding: true, outputCapturing: true
    });
    let result;
    do { result = process.getResult(); } while (result.hasExited === false);
    return JSON.stringify({
      stdoutData: result.outputData || "",
      stderrData: result.errorData || "",
      exitCode: result.exitCode === undefined ? 1 : result.exitCode
    });
  }
  if (action === "configure") {
    const vm = find(argv[1]);
    if (vm.status() !== "stopped") throw new Error("VM_NOT_STOPPED");
    const update = JSON.parse(argv[2]);
    const patch = {};
    if (update.name !== undefined) patch.name = update.name;
    if (update.memoryMiB !== undefined) patch.memory = update.memoryMiB;
    if (update.cpuCores !== undefined) patch.cpuCores = update.cpuCores;
    if (update.network === "offline") patch.networkInterfaces = [];
    if (update.network === "shared") {
      // A new interface replaces every inherited NIC, including bridged NICs.
      // UTM assigns a fresh MAC to the new interface.
      patch.networkInterfaces = [{ mode: "shared" }];
    }
    utm.updateConfiguration(vm, { "with": patch });
    return JSON.stringify({ ok: true });
  }
  throw new Error("UNKNOWN_ACTION");
}
