/** Filters host output before it reaches logs or model-visible results. */
export class SecretRedactor {
	private values: string[] = [];
	private pattern?: RegExp;

	add(secrets: string[]): void {
		const variants = secrets.filter(Boolean).flatMap(value => [value, encodeURIComponent(value.toWellFormed()), JSON.stringify(value).slice(1, -1), Buffer.from(value).toString("base64")]);
		this.values = [...new Set([...this.values, ...variants])].sort((a, b) => b.length - a.length);
		this.pattern = this.values.length ? new RegExp(this.values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : undefined;
	}

	redact(text: string): string { return this.pattern ? text.replace(this.pattern, "[REDACTED]") : text; }

	/** Retain only a suffix that could be the beginning of a secret split across chunks. */
	stream(write: (text: string) => void): { write(text: string): void; end(): void } {
		let pending = "";
		return {
			write: text => {
				pending += text;
				let boundary = pending.length;
				for (const value of this.values) {
					let offset = pending.indexOf(value[0], Math.max(0, pending.length - value.length + 1));
					while (offset !== -1) {
						if (value.startsWith(pending.slice(offset))) { boundary = Math.min(boundary, offset); break; }
						offset = pending.indexOf(value[0], offset + 1);
					}
				}
				// A complete match overlapping a retained prefix must stay intact too.
				if (this.pattern) for (const match of pending.matchAll(this.pattern)) {
					if (match.index < boundary && match.index + match[0].length > boundary) boundary = match.index;
				}
				const output = this.redact(pending.slice(0, boundary));
				pending = pending.slice(boundary);
				if (output) write(output);
			},
			end: () => { if (pending) write(this.redact(pending)); pending = ""; },
		};
	}
}
