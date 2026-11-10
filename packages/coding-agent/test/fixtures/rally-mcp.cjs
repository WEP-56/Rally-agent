// Local protocol fixture: no network or provider credentials.
const fs = require("node:fs");
const readline = require("node:readline");
fs.writeFileSync(process.argv[2], String(process.pid));
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
	const message = JSON.parse(line);
	if (message.id === undefined) return;
	if (message.method === "initialize" && process.argv[4] === "hang-initialize") {
		fs.writeFileSync(process.argv[3], "initializing\n");
		return;
	}
	let result = {};
	if (message.method === "initialize") result = {
		protocolVersion: message.params.protocolVersion,
		capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0" },
	};
	if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo fixture", inputSchema: { type: "object", properties: { message: { type: "string" }, nested: { type: "object" }, approval: { type: "string" } }, additionalProperties: false } }] };
	if (message.method === "tools/call") {
		fs.appendFileSync(process.argv[3], "called\n");
		fs.writeFileSync(`${process.argv[3]}.args.json`, JSON.stringify(message.params.arguments));
		if (process.argv[4] === "hang-call") return;
		result = { content: [{ type: "text", text: "MCP_FIXTURE_RESULT" }] };
	}
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
input.on("close", () => process.exit(0));
