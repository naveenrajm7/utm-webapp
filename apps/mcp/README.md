# UTM Web MCP adapter

This stdio MCP server uses the local UTM Web API. It never controls UTM directly.

Run `npm start --workspace=mcp` with `UTM_API_KEY` set to the same key as the API. `UTM_API_URL` defaults to `http://127.0.0.1:3001` and accepts only a loopback HTTP origin. Configure an MCP host to launch `node /absolute/path/to/apps/mcp/src/index.js` with these environment variables.

Tools: `list_vms`, `list_templates`, `create_sandbox`, `run_command`, `get_job`, and `destroy_sandbox`. Create, execution, and destruction return job IDs for polling. API failures are returned as MCP tool errors with `structuredContent.error` containing `code`, `message`, and, when available, HTTP `status` and `details`. A failed job remains inspectable and is marked as a tool error with the complete job in `structuredContent`.

The root `package-lock.json` is left to integration, as directed by `notes/AgentHandoff.md`. After merging, update the lockfile with `npm install` before using `npm ci` on the integrated branch.
