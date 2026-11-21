export interface CredentialVault {
	encrypt(value: string): Buffer;
	decrypt(ciphertext: Buffer): string;
}
