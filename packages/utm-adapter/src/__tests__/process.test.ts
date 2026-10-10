import { test, expect } from "@jest/globals";
import { SpawnRunner } from "../process";

test("spawn runner bounds combined process output", async () => {
  await expect(new SpawnRunner().run(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024))"], {
    timeoutMs: 2_000, maxOutputBytes: 128
  })).rejects.toMatchObject({ code: "output_limit" });
});

test("spawn runner kills a command after its timeout", async () => {
  await expect(new SpawnRunner().run(process.execPath, ["-e", "setInterval(() => {}, 100)"], {
    timeoutMs: 100, maxOutputBytes: 128
  })).rejects.toMatchObject({ code: "timeout" });
});
