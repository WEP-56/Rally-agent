export interface FeishuSource {
	platform: "feishu";
	appId: string;
	chatId: string;
	messageId: string;
}

export interface FeishuConnectionState {
	appId?: string;
	botName?: string;
	status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
	paired: boolean;
	tools: boolean;
	pairing?: { code: string; expiresAt: number };
	lastMessageAt?: number;
	error?: string;
}

export interface FeishuCredentials {
	appId: string;
	appSecret: string;
}
