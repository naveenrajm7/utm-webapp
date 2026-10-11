import type { UtmPort as AdapterPort, Vm as AdapterVm } from "@repo/utm-adapter";
import type { HostCapabilities, UtmPort, Vm } from "./ports";

/** Maps the UTM adapter's inventory and detail into the browser's v1 shape. */
export class LocalUtmPort implements UtmPort {
  constructor(
    private readonly adapter: Pick<AdapterPort, "getCapabilities" | "listVms" | "getVm">,
  ) {}

  async getCapabilities(): Promise<HostCapabilities> {
    const host = await this.adapter.getCapabilities();
    return {
      utmVersion: host.utmVersion,
      features: {
        clone: host.clone,
        configure: host.configure,
        guestExec: host.guestExec,
        utmctl: host.utmctlAvailable,
        jxa: host.jxaAvailable,
      },
    };
  }

  async listVms(): Promise<Vm[]> {
    return (await this.adapter.listVms()).map(vm => this.toVm(vm));
  }

  async getVm(id: string): Promise<Vm> {
    return this.toVm(await this.adapter.getVm(id));
  }

  private toVm(vm: AdapterVm): Vm {
    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      backend: vm.backend,
      network: vm.network,
      networkInterfaces: vm.networkInterfaces,
      icon: vm.icon,
      screenshot: vm.screenshot,
      memoryMiB: vm.memoryMiB,
      cpuCores: vm.cpuCores,
      architecture: vm.architecture,
      machine: vm.machine,
      serialPorts: vm.serialPorts,
      drives: vm.drives,
      capabilities: {
        clone: vm.capabilities.clone,
        configure: vm.capabilities.configure,
        start: vm.capabilities.start,
        stop: vm.capabilities.stop,
        delete: vm.capabilities.delete,
        guestExec: vm.capabilities.guestExec,
        serial: vm.capabilities.serial,
        display: vm.capabilities.display,
      },
    };
  }
}
