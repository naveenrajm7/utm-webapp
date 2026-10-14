import type { Job, Sandbox } from "../v1";
import { isStopped, type VM } from "../vm";
import { DEMO_TEMPLATES, DEMO_VMS } from "./fixtures";

const JOB_MS = 1200;
const present = (vm: VM): VM => ({
  ...vm,
  capabilities: {
    ...vm.capabilities,
    clone: isStopped(vm.status) && vm.capabilities.clone === true,
    configure: isStopped(vm.status) && vm.capabilities.configure === true,
    delete: isStopped(vm.status) && vm.capabilities.delete === true,
    start: isStopped(vm.status),
    stop: vm.status === "started" || vm.status === "running",
    guestExec: false,
    networkPresets: [],
  },
});

interface DemoJob extends Job {
  startedAt: number;
  complete?: () => Job["result"] | void;
}

const vms: VM[] = DEMO_VMS.map((vm) => ({
  ...vm,
  capabilities: { ...vm.capabilities },
}));
const jobs = new Map<string, DemoJob>();
const cloneReservations = new Set<string>();
const sandboxes = new Map<string, Sandbox>();
let sequence = 0;

const nextId = (prefix: string): string => {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fail = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, status);

const settleJobs = () => {
  const now = Date.now();
  jobs.forEach((job) => {
    if (job.state === "succeeded" || job.state === "failed" || job.state === "unknown") return;
    if (now - job.startedAt >= JOB_MS) {
      try {
        const result = job.complete?.();
        job.state = "succeeded";
        if (result) job.result = result;
      } catch (caught) {
        job.state = "failed";
        job.error = { code: "conflict",
          message: caught instanceof Error ? caught.message : "The job failed." };
      }
    } else if (now - job.startedAt >= JOB_MS / 4) {
      job.state = "running";
    }
  });
};

const queueJob = (complete: DemoJob["complete"]): string => {
  const id = nextId("job");
  jobs.set(id, { id, state: "queued", startedAt: Date.now(), complete });
  return id;
};

const publicJob = ({ id, state, result, error }: DemoJob): Job => ({
  id,
  state,
  result,
  error,
});

const simulatedOutput = (argv: string[]): string => {
  const [command, ...args] = argv;
  const name = command?.split("/").pop();
  if (name === "uname")
    return args.includes("-a")
      ? "Linux sandbox 6.1.0-25-arm64 #1 SMP Debian 6.1.106-3 aarch64 GNU/Linux\n"
      : "Linux\n";
  if (name === "echo") return `${args.join(" ")}\n`;
  if (name === "whoami") return "root\n";
  if (name === "hostname") return "sandbox\n";
  if (name === "ls") return "bin  etc  home  root  tmp  usr  var\n";
  return `${argv.join(" ")}: output is simulated in this preview\n`;
};

const handlePower = (vm: VM, action: string): Response => {
  if (action === "start") {
    if (!isStopped(vm.status))
      return fail(409, "conflict", `${vm.name} is already running.`);
    vm.status = "starting";
    return json({
      jobId: queueJob(() => {
        vm.status = "started";
        return { vmId: vm.id, status: "started" };
      }),
    }, 202);
  }
  if (isStopped(vm.status))
    return fail(409, "conflict", `${vm.name} is already stopped.`);
  vm.status = "stopping";
  return json({
    jobId: queueJob(() => {
      vm.status = "stopped";
      return { vmId: vm.id, status: "stopped" };
    }),
  }, 202);
};

const validName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 1 &&
  value.trim().length <= 100 && !Array.from(value.trim()).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });

const management = (vm: VM, method: string, action: string | undefined,
  body: Record<string, unknown>): Response => {
  const operation = action === "clone" && method === "POST" ? "clone"
    : !action && method === "PATCH" ? "configure"
    : !action && method === "DELETE" ? "delete" : null;
  if (!operation) return fail(404, "not_found", "Unknown route.");
  if (!isStopped(vm.status))
    return fail(409, "conflict", "Stop this virtual machine before changing it.");
  if (vm.capabilities[operation] !== true)
    return fail(422, "unsupported", "This operation is unavailable for this VM.");
  if (operation === "clone") {
    if (Object.keys(body).length !== 1 || !validName(body.name))
      return fail(400, "invalid_input", "Enter a valid clone name.");
    const name = (body.name as string).trim();
    if (vms.some((item) => item.name === name) || cloneReservations.has(name))
      return fail(409, "conflict", "A virtual machine with this name already exists.");
    const vmId = crypto.randomUUID();
    cloneReservations.add(name);
    return json({ jobId: queueJob(() => {
      try {
        vms.push({ ...vm, id: vmId, name, status: "stopped",
          capabilities: { ...vm.capabilities } });
        return { vmId };
      } finally {
        cloneReservations.delete(name);
      }
    }) }, 202);
  }
  if (operation === "configure") {
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) =>
      !["name", "memoryMiB", "cpuCores"].includes(key)) ||
      ("name" in body && !validName(body.name)) ||
      ("memoryMiB" in body && (!Number.isInteger(body.memoryMiB) ||
        (body.memoryMiB as number) < 128 || (body.memoryMiB as number) > 1048576)) ||
      ("cpuCores" in body && (!Number.isInteger(body.cpuCores) ||
        (body.cpuCores as number) < 0 || (body.cpuCores as number) > 256)))
      return fail(400, "invalid_input", "Invalid VM settings.");
    return json({ jobId: queueJob(() => {
      if (typeof body.name === "string") vm.name = body.name.trim();
      if (typeof body.memoryMiB === "number") vm.memoryMiB = body.memoryMiB;
      if (typeof body.cpuCores === "number") vm.cpuCores = body.cpuCores;
      return { vmId: vm.id, status: "stopped" };
    }) }, 202);
  }
  if (Object.keys(body).length !== 1 || typeof body.confirmName !== "string")
    return fail(400, "invalid_input", "Enter the exact VM name.");
  if (body.confirmName !== vm.name)
    return fail(409, "conflict", "The confirmation does not match the VM name.");
  return json({ jobId: queueJob(() => {
    if (body.confirmName !== vm.name) throw new Error("VM name changed.");
    const index = vms.findIndex((item) => item.id === vm.id);
    if (index >= 0) vms.splice(index, 1);
    return { vmId: vm.id, deleted: true };
  }) }, 202);
};

const createSandbox = (body: Record<string, unknown>): Response => {
  const template = DEMO_TEMPLATES.find((item) => item.id === body.templateId);
  if (!template)
    return fail(400, "invalid_template", "That template is not approved.");
  const ttl = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600;
  const sandboxId = nextId("sb");
  const vmId = crypto.randomUUID();
  const sandbox: Sandbox = {
    id: sandboxId,
    templateId: template.id,
    vmId,
    name: `${template.name} · clone`,
    state: "provisioning",
    leaseExpiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    capabilities: { guestExec: true },
  };
  sandboxes.set(sandboxId, sandbox);
  const source = vms.find((vm) => vm.id === template.id);
  const jobId = queueJob(() => {
    vms.push({
      ...(source as VM),
      id: vmId,
      name: sandbox.name as string,
      status: "started",
      capabilities: { stop: true, guestExec: true, serial: true },
    });
    sandbox.state = "ready";
  });
  return json({ sandboxId, jobId });
};

/** Answers `/v1` requests from memory so the static preview behaves like the API. */
export const demoFetch = async (
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  settleJobs();
  const method = (init?.method || "GET").toUpperCase();
  let body: Record<string, unknown> = {};
  if (typeof init?.body === "string") {
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return fail(400, "invalid_input", "Expected a JSON object.");
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, "invalid_input", "Expected a JSON object.");
    }
  }
  const segments = new URL(path, "http://demo.invalid").pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  if (segments[0] !== "v1")
    return fail(404, "not_found", "The preview only simulates /v1 routes.");
  const [, resource, id, action] = segments;

  if (resource === "capabilities")
    return json({ utmVersion: "5.0.6 (preview)",
      features: { clone: true, configure: true, delete: true,
        guestExec: false, utmctl: true, jxa: true }, demo: true });

  if (resource === "vms") {
    if (!id) return json(vms.map(present));
    const vm = vms.find((item) => item.id === id);
    if (!vm) return fail(404, "not_found", "Virtual machine not found.");
    if (!action && method === "GET") return json(present(vm));
    if (method === "POST" && (action === "start" || action === "stop"))
      return handlePower(vm, action);
    return management(vm, method, action, body);
  }

  if (resource === "templates") return json(DEMO_TEMPLATES);

  if (resource === "jobs" && id) {
    const job = jobs.get(id);
    return job ? json(publicJob(job)) : fail(404, "not_found", "Job not found.");
  }

  if (resource === "sandboxes") {
    if (!id && method === "POST") return createSandbox(body);
    const sandbox = id ? sandboxes.get(id) : undefined;
    if (!sandbox) return fail(404, "not_found", "Sandbox not found.");
    if (!action && method === "GET") return json(sandbox);
    if (action === "exec" && method === "POST") {
      const argv = Array.isArray(body.argv) ? body.argv.map(String) : [];
      return json({
        jobId: queueJob(() => ({
          stdout: simulatedOutput(argv),
          stderr: "",
          exitCode: 0,
        })),
      });
    }
    if (!action && method === "DELETE") {
      sandbox.state = "destroying";
      return json({
        jobId: queueJob(() => {
          sandbox.state = "destroyed";
          const index = vms.findIndex((vm) => vm.id === sandbox.vmId);
          if (index >= 0) vms.splice(index, 1);
        }),
      });
    }
  }

  return fail(404, "not_found", "Unknown route.");
};
