import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ApiError } from "./api-client.js";

function toolResult(value, isError = false, arrayKey = "items") {
  const structuredContent = Array.isArray(value) ? { [arrayKey]: value } : value;
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

function register(server, name, description, inputSchema, action) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return await action(args);
    } catch (error) {
      const apiError = error instanceof ApiError
        ? error
        : new ApiError("internal_error", "MCP adapter could not complete the request");
      return toolResult({ error: apiError.toJSON() }, true);
    }
  });
}

export function createMcpServer(api) {
  const server = new McpServer({ name: "utm-web", version: "0.0.0" });
  const noArgs = z.object({}).strict();
  const sandboxId = z.string().min(1);
  const jobId = z.string().min(1);

  register(server, "list_vms", "List local UTM VMs and their capability flags.", noArgs,
    async () => toolResult(await api.listVms(), false, "vms"));

  register(server, "list_templates", "List approved VM templates for managed sandboxes.", noArgs,
    async () => toolResult(await api.listTemplates(), false, "templates"));

  register(server, "create_sandbox", "Create a managed sandbox from an approved template. Returns sandboxId and jobId.",
    z.object({
      templateId: z.string().min(1),
      network: z.enum(["offline", "shared"]),
      ttlSeconds: z.number().int().positive(),
    }).strict(),
    async (args) => toolResult(await api.createSandbox(args)));

  register(server, "run_command", "Run a command in a managed sandbox guest. Returns jobId; use get_job for output.",
    z.object({
      sandboxId,
      argv: z.array(z.string().min(1)).min(1),
      timeoutSeconds: z.number().int().positive().optional(),
    }).strict(),
    async (args) => toolResult(await api.runCommand(args)));

  register(server, "get_job", "Inspect a job, including its state, result, or structured failure.",
    z.object({ jobId }).strict(),
    async (args) => {
      const job = await api.getJob(args);
      return toolResult(job, job.state === "failed");
    });

  register(server, "destroy_sandbox", "Stop and delete a managed sandbox. Returns jobId.",
    z.object({ sandboxId }).strict(),
    async (args) => toolResult(await api.destroySandbox(args)));

  return server;
}
