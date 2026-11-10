import { isCommandConfigValue, resolveConfigValue } from "./resolve-config-value.ts";
import { AuthStorage } from "./auth-storage.ts";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@rally/ai";

/** Async credential store overlay for non-persistent runtime API keys. */
export class RuntimeCredentials implements CredentialStore {
	private readonly store: CredentialStore;
	private readonly preserveCommands: boolean;
	private readonly commandCredentials = new WeakSet<Credential>();
	private readonly overrides = new Map<string, string>();
	/** Modifications not yet written or failed, for example an OAuth refresh. */
	private readonly pendingModifications = new Set<Promise<void>>();

	constructor(store: CredentialStore, preserveCommands = false) {
		this.preserveCommands = preserveCommands;
		this.store = store;
	}

	setRuntimeApiKey(providerId: string, apiKey: string): void {
		this.overrides.set(providerId, apiKey);
	}

	removeRuntimeApiKey(providerId: string): void {
		this.overrides.delete(providerId);
	}

	hasRuntimeApiKey(providerId: string): boolean {
		return this.overrides.has(providerId);
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const override = this.overrides.get(providerId);
		const raw = override
			? { type: "api_key" as const, key: override }
			: this.store instanceof AuthStorage
				? await this.store.read(providerId, options, this.preserveCommands)
				: await this.store.read(providerId, options);
		if (!this.preserveCommands || raw?.type !== "api_key" || !raw.key) return raw;
		if (isCommandConfigValue(raw.key)) {
			this.commandCredentials.add(raw);
			return raw;
		}
		// Only file-backed Pi configuration needs interpolation. An interpolated literal
		// beginning with ! must never become a second command evaluation.
		return !override && this.store instanceof AuthStorage
			? { ...raw, key: resolveConfigValue(raw.key, raw.env) }
			: raw;
	}

	isCommandCredential(credential: Credential): boolean {
		return this.commandCredentials.has(credential);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const entries = new Map((await this.store.list(options)).map((entry) => [entry.providerId, entry]));
		options?.signal?.throwIfAborted();
		for (const providerId of this.overrides.keys()) {
			entries.set(providerId, { providerId, type: "api_key" });
		}
		return [...entries.values()];
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const modification = this.store.modify(providerId, fn, options);
		const pending = modification.then(
			() => undefined,
			() => undefined,
		);
		this.pendingModifications.add(pending);
		void pending.finally(() => this.pendingModifications.delete(pending));
		return modification;
	}

	/**
	 * Resolves when every modification started so far is written or failed. An OAuth refresh may
	 * already have spent the single-use refresh token, so exiting before its result is written would
	 * leave only the spent token in auth.json.
	 */
	async settled(): Promise<void> {
		await Promise.all(this.pendingModifications);
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		await this.store.delete(providerId, options);
		this.overrides.delete(providerId);
	}
}
