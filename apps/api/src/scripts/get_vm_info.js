/**
 * Fetches the configuration of a UTM virtual machine by its UUID.
 * 
 * This function uses the UTM application to fetch the configuration of a UTM virtual machine
 * identified by its UUID.
 * 
 * @param {Array} argv - The arguments array, with the first element expected to be the VM UUID.
 * @returns {string} A JSON string containing the VM configuration or an error message.
 */
function run(argv) {
  if (argv.length === 0) {
    console.log("Usage: osascript -l JavaScript get_vm_info.js <VM_UUID>");
    return JSON.stringify({ status: "error", message: "No VM UUID provided." });
  }

  const vmID = argv[0];
  const utm = Application('UTM');
  utm.includeStandardAdditions = true;

  // Get the virtual machine by UUID
  const vm = utm.virtualMachines.byId(vmID);
  if (!vm) {
    return JSON.stringify({ status: "error", message: `VM with UUID ${uuid} not found` });
  }

  // Get the configuration of the virtual machine
  const config = vm.configuration();
  const vmStatus = vm.status();
  const vmInfo = {
    UUID: vm.id(),
    Name: config.name,
    Status: vmStatus,
    Architecture: config.architecture,
    Machine: config.machine,
    Memory: config.memory,
    SerialPorts: config.serialPorts,
    Drives: config.drives,
    NetworkInterfaces: config.networkInterfaces,
  };

  return JSON.stringify(vmInfo);
}
