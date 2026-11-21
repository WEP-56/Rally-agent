import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import type { ImapFlow } from "imapflow";
import { expect, it, vi } from "vitest";
import { qqMailTransport } from "../../../../src/main/qqmail-transport.ts";

const fixture = vi.hoisted(() => ({ port: 0 }));
vi.mock("imapflow", async importOriginal => {
	const actual = await importOriginal<{ ImapFlow: typeof ImapFlow }>();
	return { ...actual, ImapFlow: class extends actual.ImapFlow {
		constructor(options: ConstructorParameters<typeof actual.ImapFlow>[0]) {
			super({ ...options, host: "127.0.0.1", port: fixture.port, secure: false, doSTARTTLS: false });
		}
	} };
});

const raw = Buffer.from([
	"From: Fixture <fixture@example.invalid>", "Subject: Test body and attachment", "Message-ID: <fixture@example.invalid>",
	"MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="fixture"', "", "--fixture",
	"Content-Type: text/plain; charset=utf-8", "", "来自回归测试的正文", "--fixture",
	'Content-Type: application/octet-stream; name="test.bin"', 'Content-Disposition: attachment; filename="test.bin"',
	"Content-Transfer-Encoding: base64", "", "AAEC/w==", "--fixture--", "",
].join("\r\n"));

async function withInbox(mode: "complete" | "tooLarge" | "truncated", run: (commands: string[]) => Promise<void>) {
	const commands: string[] = [];
	const sockets = new Set<Socket>();
	const server = createServer(socket => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		socket.write("* OK [CAPABILITY IMAP4rev1] Fixture server ready\r\n");
		let pending = "";
		socket.on("data", chunk => {
			pending += chunk.toString();
			let end: number;
			while ((end = pending.indexOf("\r\n")) !== -1) {
				const line = pending.slice(0, end);
				pending = pending.slice(end + 2);
				const split = line.indexOf(" ");
				const tag = line.slice(0, split);
				const command = line.slice(split + 1);
				commands.push(command);
				const ok = (prefix = "") => socket.write(`${prefix}${tag} OK completed\r\n`);
				if (command.startsWith("LOGIN ")) ok();
				else if (command === "CAPABILITY") ok("* CAPABILITY IMAP4rev1\r\n");
				else if (command.startsWith("LIST ")) ok('* LIST () "/" "INBOX"\r\n');
				else if (command === "EXAMINE INBOX") ok("* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 1024] fixture\r\n* OK [UIDNEXT 6] fixture\r\n");
				else if (command.startsWith("UID FETCH 5 ")) {
					const size = `RFC822.SIZE ${raw.length + 12}`; // Independent metadata differs from the literal length.
					if (!command.includes("BODY.PEEK[]")) { ok(`* 1 FETCH (UID 5 ${size})\r\n`); continue; }
					const partial = command.includes("BODY.PEEK[]<");
					const length = mode === "tooLarge" ? 16 * 1024 * 1024 + 1 : raw.length;
					socket.write(`* 1 FETCH (UID 5 ${size} BODY[]${partial ? "<0>" : ""} {${length}}\r\n`);
					if (mode === "truncated") socket.end(raw.subarray(0, raw.length - 25));
					else if (mode === "complete") { socket.write(raw); ok(")\r\n"); }
				} else socket.write(`${tag} BAD unexpected command\r\n`);
			}
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server port");
	fixture.port = address.port;
	try { await run(commands); }
	finally {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
}

const read = () => qqMailTransport.read({ address: "fixture@qq.com", authorizationCode: "local-fixture-only" }, { uid: 5, uidValidity: "1024" }, AbortSignal.timeout(3000));

it("parses the body and attachment when the server advertises an inaccurate message size", async () => {
	await withInbox("complete", async commands => {
		const mail = await read();
		expect(mail.text.trim()).toBe("来自回归测试的正文");
		expect(mail.attachments).toMatchObject([{ filename: "test.bin", content: Buffer.from([0, 1, 2, 255]) }]);
		expect(commands).toContain("EXAMINE INBOX");
		expect(commands.filter(command => command.startsWith("UID FETCH"))).toEqual(["UID FETCH 5 (BODY.PEEK[] UID)"]);
	});
});

it("refuses a reply that exceeds the raw email byte limit before reading its contents", async () => {
	await withInbox("tooLarge", async () => {
		await expect(read()).rejects.toThrow(/超过 16 MiB/);
	});
});

it("rejects a disconnected fetch instead of parsing a partial MIME message", async () => {
	await withInbox("truncated", async () => {
		await expect(read()).rejects.toThrow();
	});
});
