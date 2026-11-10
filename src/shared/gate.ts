/** The request is frozen before approval; only its decision may change. */
export interface TaskGate {
	id: string;
	runId: string;
	toolCallId: string;
	tool: string;
	action: string;
	cwd: string;
	scope: string[];
	alternative: string;
	arguments: Record<string, unknown>;
	requestedAt: number;
	expiresAt: number;
	escalatedAt?: number;
	decision?: {
		value: "allow" | "deny";
		actor: "main" | "user" | "system";
		basis: string[];
		reason: string;
		at: number;
	};
}

export interface GateDescription {
	action: string;
	scope: string[];
	alternative: string;
}
