import { Type } from "typebox";
import type { CredentialEnvironment } from "../shared/credentials.ts";
import type { WebsiteAccounts } from "./website-accounts.ts";

export const CredentialEnvironmentSchema = Type.Record(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), Type.Object({
	id: Type.String({ minLength: 1 }),
	field: Type.Optional(Type.Union([Type.Literal("username"), Type.Literal("secret")])),
}, { additionalProperties: false }), { maxProperties: 32 });

export const CREDENTIAL_ENV_DESCRIPTION = " Optional credentialEnv maps environment variable names to {id,field} from credential_list; field defaults to secret (password/token), or username. Rally injects values only into this invocation and masks their output. In Bash read $NAME; in PowerShell read $env:NAME; scripts can read their process environment. Never put secrets into command text, URLs or reports. Persist a secret in configuration only when the user explicitly requests it. Credential access does not authorize an action or bypass a gate.";

export function credentialEnvironment(accounts: WebsiteAccounts | undefined, references: CredentialEnvironment | undefined): Record<string, string> {
	if (references === undefined) return {};
	if (!accounts) throw Error("密码本不可用");
	if (!references || typeof references !== "object" || Array.isArray(references) || Object.keys(references).length > 32) throw Error("凭据环境变量格式无效");
	const values: Record<string, string> = {};
	const names = new Set<string>();
	for (const [name, reference] of Object.entries(references)) {
		const upper = name.toUpperCase();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /^(?:PATH|PATHEXT|HOME|USERPROFILE|SYSTEMROOT|COMSPEC|SHELL|ENV|BASH_ENV|NODE_OPTIONS|RALLY_.*|LD_.*|DYLD_.*|GIT_CONFIG.*)$/.test(upper) || names.has(upper)) throw Error("凭据环境变量名称无效、重复或属于系统保留项");
		names.add(upper);
		Object.defineProperty(values, name, { value: accounts.valueForHost(reference), enumerable: true });
	}
	return values;
}

/** Only HTTP headers/body support these placeholders; URLs and commands remain literal. */
export function credentialTemplate(value: string, accounts: WebsiteAccounts | undefined, secrets: string[]): string {
	return value.replace(/\{\{credential:([^{}:]+):(username|secret)\}\}/g, (_match, id: string, field: "username" | "secret") => {
		if (!accounts) throw Error("密码本不可用");
		const secret = accounts.valueForHost({ id, field });
		secrets.push(secret);
		return secret;
	});
}
