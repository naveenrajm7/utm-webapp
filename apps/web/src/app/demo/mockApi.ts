import type { Job, Sandbox } from "../v1";
import type { VM } from "../vm";
import { DEMO_TEMPLATES, DEMO_VMS } from "./fixtures";

const JOB_MS = 1200;

interface DemoJob extends Job {
  startedAt: number;
  complete?: () => Job["result"] | void;
}

const vms: VM[] = DEMO_VMS.map((vm) => ({
  ...vm,
  capabilities: { ...vm.capabilities },
}));
const jobs = new Map<string, DemoJob>();
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
    if (job.state === "succeeded" || job.state === "failed") return;
    if (now - job.startedAt >= JOB_MS) {
      const result = job.complete?.();
      job.state = "succeeded";
      if (result) job.result = result;
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
    if (vm.status === "started")
      return fail(409, "conflict", `${vm.name} is already running.`);
    vm.status = "starting";
    return json({
      jobId: queueJob(() => {
        vm.status = "started";
      }),
    });
  }
  if (vm.status === "stopped")
    return fail(409, "conflict", `${vm.name} is already stopped.`);
  vm.status = "stopping";
  return json({
    jobId: queueJob(() => {
      vm.status = "stopped";
    }),
  });
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
  const body =
    typeof init?.body === "string"
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
  const segments = new URL(path, "http://demo.invalid").pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  if (segments[0] !== "v1")
    return fail(404, "not_found", "The preview only simulates /v1 routes.");
  const [, resource, id, action] = segments;

  if (resource === "capabilities")
    return json({ utmVersion: "5.0.6 (preview)", demo: true });

  if (resource === "vms") {
    if (!id) return json(vms);
    const vm = vms.find((item) => item.id === id);
    if (!vm) return fail(404, "not_found", "Virtual machine not found.");
    if (!action && method === "GET") return json(vm);
    if (method === "POST" && (action === "start" || action === "stop"))
      return handlePower(vm, action);
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
