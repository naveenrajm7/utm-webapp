import type { UtmPort as AdapterPort, Vm as AdapterVm, HostCapabilities as AdapterHostCapabilities } from "@repo/utm-adapter";
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
        delete: (host as typeof host & { delete?: boolean }).delete === true,
        guestExec: false,
        utmctl: host.utmctlAvailable,
        jxa: host.jxaAvailable,
      },
    };
  }

  async listVms(): Promise<Vm[]> {
    const [host, vms] = await Promise.all([this.adapter.getCapabilities(), this.adapter.listVms()]);
    return vms.map(vm => this.toVm(vm, host));
  }

  async getVm(id: string): Promise<Vm> {
    const [host, vm] = await Promise.all([this.adapter.getCapabilities(), this.adapter.getVm(id)]);
    return this.toVm(vm, host);
  }

  private toVm(vm: AdapterVm, host: AdapterHostCapabilities): Vm {
    const stopped = vm.status === "stopped" && vm.backend !== "unavailable";
    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      backend: vm.backend,
      network: vm.network,
      memoryMiB: vm.memoryMiB,
      cpuCores: vm.cpuCores,
      architecture: vm.architecture,
      machine: vm.machine,
      serialPorts: vm.serialPorts,
      drives: vm.drives,
      capabilities: {
        clone: stopped && host.clone && vm.capabilities.clone,
        configure: stopped && host.configure && vm.capabilities.configure,
        start: vm.capabilities.start,
        stop: vm.capabilities.stop,
        delete: stopped && (host as typeof host & { delete?: boolean }).delete === true && vm.capabilities.delete,
        guestExec: false,
        networkPresets: [],
        serial: vm.capabilities.serial,
        display: vm.capabilities.display,
      },
    };
  }
}
