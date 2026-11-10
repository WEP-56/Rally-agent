export type McpRiskTier = "reversible" | "external" | "irreversible";
export type McpExposure = "direct" | "deferred" | "codemode" | "hidden";

export interface McpServerSettings {
	name: string;
	enabled: boolean;
	transport: "stdio" | "http";
	address: string;
	exposure: McpExposure;
	toolExposure: Record<string, McpExposure>;
}

export interface McpConfigurationState {
	json: string;
	servers: McpServerSettings[];
	errors: string[];
	tools: { name: string; tier: McpRiskTier }[];
}
