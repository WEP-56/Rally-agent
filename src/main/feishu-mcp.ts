import { Client, LoggerLevel } from "@larksuiteoapi/node-sdk";
import { larkOapiHandler } from "@larksuiteoapi/lark-mcp/dist/mcp-tool/utils/handler.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerEntry } from "@rally/coding-agent";
import type { JsonRpcMessage, McpTransport } from "@rally/mcp";
import type { FeishuConnection } from "./feishu-connection.ts";
import { FEISHU_SERVER_NAME, FEISHU_TOOLS } from "./connector-tools.ts";

// Import the pinned vendor schemas and API handler directly. Its CLI entry parses argv
// and initializes a separate OAuth/keytar store, while Rally only uses app identity.
export const FEISHU_MCP_ENTRY: McpServerEntry = {
	name: FEISHU_SERVER_NAME, source: "rally:feishu", scope: "extension",
	config: { command: "rally:feishu", description: "Feishu: read shared documents and wiki nodes, search records in shared Bitable tables (app identity)." },
};

/** Use the vendor server and MCP SDK's linked transports. Secrets stay in the main process. */
export function feishuMcpTransport(connection: FeishuConnection): McpTransport {
	const [client, serverTransport] = InMemoryTransport.createLinkedPair();
	const server = new McpServer({ name: "rally-feishu", version: "1" });
	let closed = false;
	let unsubscribe: (() => void) | undefined;
	const close = async () => {
		if (closed) return;
		closed = true;
		unsubscribe?.();
		await client.close();
		await server.close();
	};
	return {
		async start() {
			if (closed) throw new Error("飞书连接已关闭。");
			const { credentials, release } = connection.openTools(close);
			unsubscribe = release;
			try {
				const lark = new Client({ ...credentials, loggerLevel: LoggerLevel.fatal });
				for (const { tool } of FEISHU_TOOLS) {
					const { useUAT: _userToken, ...inputSchema } = tool.schema;
					server.registerTool(tool.name, { description: tool.description, inputSchema, annotations: { readOnlyHint: true } }, args =>
						larkOapiHandler(lark, { ...args, useUAT: false }, { tool }));
				}
				await server.connect(serverTransport);
				if (closed) throw new Error("飞书连接已关闭。");
				await client.start();
			} catch { await close(); throw new Error("飞书工具启动失败，请检查连接设置。"); }
		},
		async send(message, options) {
			options?.signal?.throwIfAborted();
			if (closed || !connection.toolsEnabled()) throw new Error("飞书工具未授权。");
			await client.send(message as JSONRPCMessage);
		},
		close,
		onMessage(listener) { client.onmessage = msg => listener(msg as JsonRpcMessage); return () => { client.onmessage = undefined; }; },
		onError(listener) { client.onerror = listener; return () => { client.onerror = undefined; }; },
		onClose(listener) { client.onclose = listener; return () => { client.onclose = undefined; }; },
	};
}
