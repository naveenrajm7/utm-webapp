import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { demoFetch } from "./mockApi";
import { DEMO_VM_IDS } from "./fixtures";

const path = `/v1/vms/${DEMO_VM_IDS[1]}`;
const body = (value: unknown, method: string): RequestInit => ({
  method, body: JSON.stringify(value),
});
const read = async (response: Response): Promise<Record<string, any>> =>
  response.json() as Promise<Record<string, any>>;

describe("static demo direct VM contract", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("returns typed admissions and reconciled clone, settings, and delete jobs", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
    const capabilities = await read(await demoFetch("/v1/capabilities"));
    expect(capabilities.features).toMatchObject({
      clone: true, configure: true, delete: true,
    });
    const vm = await read(await demoFetch(path));
    expect(vm.capabilities).toMatchObject({
      clone: true, configure: true, delete: true, networkPresets: [],
    });

    const invalid = await demoFetch(path, body({ network: "offline" }, "PATCH"));
    expect(invalid.status).toBe(400);
    expect((await read(invalid)).error.code).toBe("invalid_input");

    const settings = await demoFetch(path, body({ memoryMiB: 12288, cpuCores: 0 }, "PATCH"));
    expect(settings.status).toBe(202);
    const settingsJob = (await read(settings)).jobId;
    clock.mockReturnValue(2400);
    expect(await read(await demoFetch(`/v1/jobs/${settingsJob}`))).toMatchObject({
      state: "succeeded", result: { vmId: DEMO_VM_IDS[1], status: "stopped" },
    });
    expect(await read(await demoFetch(path))).toMatchObject({
      memoryMiB: 12288, cpuCores: 0,
    });

    const clone = await demoFetch(`${path}/clone`, body({ name: "Demo copy" }, "POST"));
    expect(clone.status).toBe(202);
    const cloneJob = (await read(clone)).jobId;
    const duplicate = await demoFetch(`${path}/clone`, body({ name: "Demo copy" }, "POST"));
    expect(duplicate.status).toBe(409);
    expect((await read(duplicate)).error.code).toBe("conflict");
    clock.mockReturnValue(3800);
    const cloneResult = await read(await demoFetch(`/v1/jobs/${cloneJob}`));
    expect(cloneResult).toMatchObject({ state: "succeeded" });
    expect((await read(await demoFetch("/v1/vms")) as unknown as Array<{id: string}>)
      .some((item) => item.id === cloneResult.result.vmId)).toBe(true);

    const mismatch = await demoFetch(path, body({ confirmName: "windows 11 ARM" }, "DELETE"));
    expect(mismatch.status).toBe(409);
    expect((await read(mismatch)).error.code).toBe("conflict");
    const removal = await demoFetch(path, body({ confirmName: vm.name }, "DELETE"));
    expect(removal.status).toBe(202);
    const deleteJob = (await read(removal)).jobId;
    clock.mockReturnValue(5200);
    expect(await read(await demoFetch(`/v1/jobs/${deleteJob}`))).toMatchObject({
      state: "succeeded", result: { vmId: DEMO_VM_IDS[1], deleted: true },
    });
    expect((await demoFetch(path)).status).toBe(404);
  });
});
