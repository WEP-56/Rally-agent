import { docxV1DocumentRawContent } from "@larksuiteoapi/lark-mcp/dist/mcp-tool/tools/en/gen-tools/zod/docx_v1.js";
import { wikiV2SpaceGetNode } from "@larksuiteoapi/lark-mcp/dist/mcp-tool/tools/en/gen-tools/zod/wiki_v2.js";
import { bitableV1AppTableRecordSearch } from "@larksuiteoapi/lark-mcp/dist/mcp-tool/tools/en/gen-tools/zod/bitable_v1.js";
import { createMcpToolName } from "@rally/mcp";
import type { ConnectorId } from "../shared/connections.ts";
import type { McpRiskTier } from "../shared/mcp.ts";

export const FEISHU_SERVER_NAME = "rally_feishu";
export const FEISHU_TOOLS = [
	{ tool: docxV1DocumentRawContent, label: "读取飞书文档" },
	{ tool: wikiV2SpaceGetNode, label: "读取飞书知识库节点" },
	{ tool: bitableV1AppTableRecordSearch, label: "检索飞书多维表格记录" },
];

/** Connector-owned tools are listed before first use, regardless of their transport. */
export const CONNECTOR_TOOLS: Record<ConnectorId, { name: string; label: string; defaultTier: McpRiskTier }[]> = {
	ssh: [
		{ name: "ssh_list", label: "查看 SSH 服务器", defaultTier: "reversible" },
		{ name: "ssh_exec", label: "执行 SSH 命令", defaultTier: "irreversible" },
		{ name: "ssh_write_stdin", label: "继续 SSH 会话（读取免审批，输入按权限）", defaultTier: "irreversible" },
	],
	feishu: FEISHU_TOOLS.map(({ tool, label }) => ({ name: createMcpToolName(FEISHU_SERVER_NAME, tool.name), label, defaultTier: "reversible" })),
	qqmail: [
		{ name: "qqmail_search", label: "检索 QQ 邮件", defaultTier: "reversible" },
		{ name: "qqmail_read", label: "读取 QQ 邮件", defaultTier: "reversible" },
		{ name: "qqmail_save_attachment", label: "保存 QQ 邮件附件", defaultTier: "reversible" },
		{ name: "qqmail_send", label: "发送或回复 QQ 邮件", defaultTier: "irreversible" },
	],
};

export function connectorTool(name: string) {
	return Object.values(CONNECTOR_TOOLS).flat().find(tool => tool.name === name);
}
