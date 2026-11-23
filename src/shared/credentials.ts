export interface WebsiteAccount {
	id: string;
	origin: string;
	enabled: boolean;
	createdAt: number;
}
export interface CredentialRequest {
	id: string;
	origin: string;
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
export interface CredentialSubmission {
	requestId: string;
	website: string;
	username: string;
	password: string;
}
