import type { McpRiskTier } from "./mcp.ts";

export type ConnectorId = "feishu" | "qqmail" | "ssh";
export interface ConnectorToolSettings {
	name: string;
	label: string;
	tier: McpRiskTier;
}

interface MessageSource {
	/** Bound sender for safe reply delivery after reconnection or restart. */
	senderId?: string;
	appId: string;
	chatId: string;
	messageId: string;
}

export interface FeishuSource extends MessageSource { platform: "feishu" }
export interface QqBotSource extends MessageSource { platform: "qq" }
export type ImSource = FeishuSource | QqBotSource;

export const IM_SOURCE_LABELS = { feishu: "飞书", qq: "QQ" } as const;

export interface ImBotState {
	appId?: string;
	botName?: string;
	status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
	paired: boolean;
	pairing?: { code: string; expiresAt: number };
	lastMessageAt?: number;
	error?: string;
}

export interface FeishuConnectionState extends ImBotState { tools: boolean }

export interface ImBotCredentials {
	appId: string;
	appSecret: string;
}
export type FeishuCredentials = ImBotCredentials;

export interface QqMailCredentials {
	address: string;
	authorizationCode: string;
}

export interface QqMailState {
	address?: string;
	status: "disconnected" | "checking" | "connected" | "error";
	checkedAt?: number;
	error?: string;
}
