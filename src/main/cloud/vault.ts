import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CredentialVault } from "../credential-vault.ts";
export function cloudVault(key: Buffer): CredentialVault {
	if (key.length !== 32) throw new Error("连接器主密钥无效");
	return {
		encrypt(text) {
			const iv = randomBytes(12),
				cipher = createCipheriv("aes-256-gcm", key, iv);
			const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
			return Buffer.concat([iv, cipher.getAuthTag(), data]);
		},
		decrypt(data) {
			const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
			cipher.setAuthTag(data.subarray(12, 28));
			return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
		},
	};
}
