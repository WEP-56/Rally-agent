import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LarkChannel, NormalizedMessage } from "@larksuiteoapi/node-sdk";
import { createMcpToolName, McpClient } from "@rally/mcp";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuConnection } from "../../../../src/main/feishu-connection.ts";
import { feishuMcpTransport } from "../../../../src/main/feishu-mcp.ts";
import { McpStore } from "../../../../src/main/mcp-store.ts";
import { createHarness, type Harness } from "./harness.ts";

const credentials = { appId: "cli_fixture1", appSecret: "secret_fixture1" };
const vault = { encrypt: (value: string) => Buffer.from([...value].reverse().join("")), decrypt: (value: Buffer) => [...value.toString()].reverse().join("") };
const connections: FeishuConnection[] = [];
const harnesses: Harness[] = [];
afterEach(async () => {
	await Promise.all(connections.splice(0).map(connection => connection.dispose()));
	for (const harness of harnesses.splice(0)) harness.cleanup();
});

function stubChannel() {
	let handler: ((message: NormalizedMessage) => void | Promise<void>) | undefined;
	const channel = {
		connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
		getConnectionStatus: (): ReturnType<LarkChannel["getConnectionStatus"]> => ({ state: "connected", lastConnectTime: 0, nextConnectTime: 0, reconnectAttempts: 0 }),
		updatePolicy: vi.fn(), send: vi.fn(async () => ({ messageId: "om_reply" })),
		botIdentity: { name: "Rally 测试机器人", openId: "ou_bot" },
		on(_name: "message", listener: NonNullable<typeof handler>) { handler = listener; return () => { handler = undefined; }; },
	};
	return { channel, emit: (content: string, overrides: Partial<NormalizedMessage> = {}) => handler?.({
		messageId: "om_message", chatId: "oc_private", chatType: "p2p", senderId: "ou_owner", content,
		rawContentType: "text", resources: [], mentions: [], mentionAll: false, mentionedBot: false, createTime: Date.now(), ...overrides,
	}) };
}

async function fixture() {
	const harness = await createHarness();
	harnesses.push(harness);
	const receive = vi.fn(async () => "主对话回复");
	const first = stubChannel();
	const factory = vi.fn(() => first.channel);
	const connection = new FeishuConnection(harness.tempDir, vault, receive, factory);
	connections.push(connection);
	connection.save(credentials);
	await vi.waitFor(() => expect(connection.state().status).toBe("connected"));
	return { ...first, factory, connection, receive, home: harness.tempDir };
}

it("pairs only a private text sender, routes and replies in the original Feishu chat, and persists the owner", async () => {
	const { channel, connection, receive, home, emit } = await fixture();
	expect(connection.state()).not.toHaveProperty("appSecret");
	await emit("未授权的请求");
	const { pairing } = connection.pair();
	await emit(`/pair ${pairing!.code}`, { chatType: "group" });
	await emit("/pair wrong");
	expect(connection.state().paired).toBe(false);
	expect(receive).not.toHaveBeenCalled();
	await emit(`/pair ${pairing!.code}`);
	expect(connection.state()).toMatchObject({ paired: true, pairing: undefined, tools: false });
	expect(channel.updatePolicy).toHaveBeenLastCalledWith({ dmMode: "allowlist", dmAllowlist: ["ou_owner"] });
	await emit("其他人", { senderId: "ou_other" });
	await emit("群聊", { chatType: "group" });
	await emit("图片", { rawContentType: "image" });
	await emit("执行原话", { messageId: "om_request" });
	expect(receive).toHaveBeenCalledExactlyOnceWith("执行原话", { platform: "feishu", appId: credentials.appId, chatId: "oc_private", messageId: "om_request" });
	expect(channel.send).toHaveBeenLastCalledWith("oc_private", { text: "主对话回复" }, { replyTo: "om_request" });
	expect(readFileSync(join(home, "feishu-connection.json"), "utf8")).not.toContain(credentials.appSecret);
	const reopened = stubChannel();
	const factory = vi.fn(() => reopened.channel);
	await connection.dispose();
	const restart = new FeishuConnection(home, vault, receive, factory);
	connections.push(restart);
	restart.start();
	expect(factory).toHaveBeenCalledWith(credentials, "ou_owner");
	restart.disconnect();
	await reopened.emit("断开后不再进入主对话");
	expect(receive).toHaveBeenCalledTimes(1);
});

it("uses the actual vendor MCP server with a read-only allowlist, then closes it on revocation", async () => {
	const { connection, emit, home } = await fixture();
	const client = new McpClient({ name: "rally-test", version: "1.0.0" });
	await expect(client.connect(feishuMcpTransport(connection))).rejects.toThrow("飞书工具未授权");
	const { pairing } = connection.pair();
	await emit(`/pair ${pairing!.code}`);
	connection.setTools(true);
	const worker = new McpClient({ name: "rally-worker-test", version: "1.0.0" });
	try {
		await worker.connect(feishuMcpTransport(connection));
		expect(new McpStore(home).connectorTools("feishu").map(tool => tool.name).sort()).toEqual(
			(await worker.listTools()).map(tool => createMcpToolName("rally_feishu", tool.name)).sort(),
		);
		expect((await worker.listTools()).map(tool => tool.name).sort()).toEqual([
			"bitable.v1.appTableRecord.search", "docx.v1.document.rawContent", "wiki.v2.space.getNode",
		]);
		connection.setTools(false);
		await expect(worker.listTools()).rejects.toThrow();
	} finally { await worker.close(); }
});
