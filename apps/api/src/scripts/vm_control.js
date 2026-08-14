/**
 * Controls a UTM virtual machine through the UTM scripting interface.
 *
 * @param {Array} argv - [action, VM_UUID] where action is start, stop, status, serial or vnc.
 * @returns {string} A JSON string with the result of the action.
 */
function run(argv) {
  if (argv.length < 2) {
    return JSON.stringify({
      status: "error",
      message: "Usage: osascript -l JavaScript vm_control.js <start|stop|status|serial> <VM_UUID>",
    });
  }

  const action = argv[0];
  const vmID = argv[1];

  const utm = Application("UTM");
  utm.includeStandardAdditions = true;

  try {
    const vm = utm.virtualMachines.byId(vmID);

    switch (action) {
      case "start":
        utm.start(vm);
        return JSON.stringify({ status: "success", vmStatus: vm.status() });

      case "stop":
        utm.stop(vm);
        return JSON.stringify({ status: "success", vmStatus: vm.status() });

      case "status":
        return JSON.stringify({ status: "success", vmStatus: vm.status() });

      case "serial": {
        const ports = vm.serialPorts();

        if (!ports || ports.length === 0) {
          return JSON.stringify({
            status: "error",
            message: "VM has no serial ports; add one in the VM's UTM configuration",
          });
        }

        // The host side of the port only exists while the VM is running.
        const address = ports[0].address();

        if (!address) {
          return JSON.stringify({
            status: "error",
            message: `Serial port is not connected (VM is ${vm.status()}); start the VM first`,
          });
        }

        return JSON.stringify({ status: "success", address: address });
      }

      case "vnc": {
        // UTM has no VNC setting of its own, so the display is declared by a
        // `-vnc <host>:<display>` entry in the VM's extra QEMU arguments.
        const args = vm.configuration().qemuAdditionalArguments || [];

        for (let i = 0; i < args.length; i++) {
          const match = String(args[i].argumentString || "").match(/^-vnc\s+(?:([^\s:]*):)?(\d+)/);

          if (match) {
            return JSON.stringify({
              status: "success",
              vncHost: match[1] || "127.0.0.1",
              vncPort: 5900 + parseInt(match[2], 10),
            });
          }
        }

        return JSON.stringify({
          status: "error",
          message: "VM has no VNC display; add a '-vnc 127.0.0.1:<n>' QEMU argument to its configuration",
        });
      }

      default:
        return JSON.stringify({ status: "error", message: `Unknown action: ${action}` });
    }
  } catch (e) {
    return JSON.stringify({ status: "error", message: String((e && e.message) || e) });
  }
}
