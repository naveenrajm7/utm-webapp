import type { UtmPort as AdapterPort, Vm as AdapterVm } from "@repo/utm-adapter";
import { getLegacyVmInfo } from "../services/legacyVmService";
import { getVncTarget } from "../utils/getVncTarget";
import type { HostCapabilities, UtmPort, Vm } from "./ports";

/** Maps the installed UTM adapter to the browser's v1 VM response. */
export class LocalUtmPort implements UtmPort {
  constructor(
    private readonly adapter: Pick<AdapterPort, "getCapabilities" | "listVms" | "getVm">,
    private readonly details = getLegacyVmInfo,
    private readonly vncTarget = getVncTarget,
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
    const vm = this.toVm(await this.adapter.getVm(id));
    try {
      const details = await this.details(id);
      if (details.UUID === vm.id && details.status !== "error") {
        if (typeof details.Architecture === "string") vm.architecture = details.Architecture;
        if (typeof details.Machine === "string") vm.machine = details.Machine;
        if (details.SerialPorts !== undefined) {
          vm.serialPorts = details.SerialPorts;
          vm.capabilities.serial = Array.isArray(details.SerialPorts) && details.SerialPorts.length > 0;
        }
        if (details.Drives !== undefined) vm.drives = details.Drives;
      }
    } catch {
      // Base inventory still works if a VM does not expose legacy detail fields.
    }
    if (vm.backend === "qemu") {
      try {
        await this.vncTarget(id);
        vm.capabilities.display = true;
      } catch {
        // Only a configured, loopback VNC target is advertised.
      }
    }
    return vm;
  }

  private toVm(vm: AdapterVm): Vm {
    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      backend: vm.backend,
      network: vm.network,
      memoryMiB: vm.memoryMiB,
      cpuCores: vm.cpuCores,
      capabilities: {
        clone: vm.capabilities.clone,
        configure: vm.capabilities.configure,
        start: vm.capabilities.start,
        stop: vm.capabilities.stop,
        delete: vm.capabilities.delete,
        guestExec: vm.capabilities.guestExec,
        serial: false,
        display: false,
      },
    };
  }
}
