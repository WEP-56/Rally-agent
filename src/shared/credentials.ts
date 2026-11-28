export type CredentialKind = "account" | "secret";
export interface CredentialReference { id: string; field?: "username" | "secret" }
export type CredentialEnvironment = Record<string, CredentialReference>;

export interface WebsiteAccount {
	id: string;
	/** Service name or HTTP(S) origin; retained for compatibility with saved accounts. */
	origin: string;
	kind?: CredentialKind;
	label?: string;
	enabled: boolean;
	createdAt: number;
}
export interface CredentialRequest {
	id: string;
	origin: string;
	kind?: CredentialKind;
	label?: string;
	status: "pending" | "saved" | "cancelled" | "expired";
	createdAt: number;
	purpose?: string;
	taskId?: string;
	runId?: string;
	accountId?: string;
}
export interface CredentialState {
	accounts: WebsiteAccount[];
	requests: CredentialRequest[];
}
export interface CredentialInput {
	kind?: CredentialKind;
	label?: string;
	username?: string;
	password: string;
}
export interface CredentialSubmission extends CredentialInput {
	requestId: string;
	website: string;
}
