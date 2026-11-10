export type McpRiskTier = "reversible" | "external" | "irreversible";

export interface McpConfigurationState {
	json: string;
	servers: { name: string; enabled: boolean; transport: "stdio" | "http"; address: string }[];
	errors: string[];
	tools: { name: string; tier: McpRiskTier }[];
}
