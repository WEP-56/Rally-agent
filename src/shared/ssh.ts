export interface SshServer {
	id: string;
	name: string;
	host: string;
	port: number;
	username: string;
	auth: "password" | "privateKey";
	enabled: boolean;
	fingerprint?: string;
	checkedAt?: number;
}

/** Secrets are write-only; omitting them while editing keeps the saved credentials. */
export interface SshServerInput {
	id?: string;
	name: string;
	host: string;
	port: number;
	username: string;
	auth: "password" | "privateKey";
	secret?: string;
	passphrase?: string;
}

export interface SshVerification {
	status: "verified" | "confirm";
	fingerprint: string;
	previousFingerprint?: string;
}

export interface SshResult {
	sessionId: string;
	status: "running" | "exited" | "disconnected" | "closed";
	output: string;
	hasMore: boolean;
	exitCode?: number;
	exitSignal?: string;
	error?: string;
	logPath: string;
}
