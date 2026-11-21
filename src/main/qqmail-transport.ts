import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { QqMailCredentials } from "../shared/connections.ts";

export interface MailRef { uid: number; uidValidity: string }
export interface MailQuery { subject?: string; from?: string; text?: string; since?: string; unread?: boolean; limit: number }
export interface MailAddress { name?: string; address?: string }
export interface MailSummary {
	ref: MailRef;
	subject: string;
	from: MailAddress[];
	date?: Date | string;
}
export interface MailContent {
	subject: string;
	from: MailAddress[];
	date?: Date;
	messageId?: string;
	text: string;
	attachments: { filename?: string; contentType: string; content: Buffer }[];
}
export interface OutgoingMail {
	to: string[];
	cc: string[];
	subject: string;
	text: string;
	inReplyTo?: string;
	attachments: { filename: string; content: Buffer }[];
}
export interface QqMailTransport {
	verify(auth: QqMailCredentials, signal: AbortSignal): Promise<void>;
	search(auth: QqMailCredentials, search: MailQuery, signal: AbortSignal): Promise<MailSummary[]>;
	read(auth: QqMailCredentials, ref: MailRef, signal: AbortSignal): Promise<MailContent>;
	send(auth: QqMailCredentials, mail: OutgoingMail, signal: AbortSignal): Promise<{ messageId: string; accepted: string[]; rejected: string[] }>;
}

export class QqMailReadError extends Error {}

const RAW_LIMIT = 16 * 1024 * 1024;
const IMAP = "imap.qq.com";
const SMTP = "smtp.qq.com";
const OVERSIZE = "这封邮件超过 16 MiB，请在 QQ 邮箱中打开。";

function smtp(auth: QqMailCredentials) {
	return nodemailer.createTransport({ host: SMTP, port: 465, secure: true, pool: true, forceAuth: true, maxConnections: 1, maxMessages: 1, maxRequeues: 0,
		auth: { user: auth.address, pass: auth.authorizationCode }, connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000,
		disableFileAccess: true, disableUrlAccess: true });
}

async function useImap<T>(auth: QqMailCredentials, signal: AbortSignal, work: (client: ImapFlow) => Promise<T>): Promise<T> {
	signal.throwIfAborted();
	const client = new ImapFlow({ host: IMAP, port: 993, secure: true, auth: { user: auth.address, pass: auth.authorizationCode },
		logger: false, disableAutoIdle: true, connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000,
		maxLiteralSize: RAW_LIMIT });
	// Parser failures surface as an event; the pending fetch may only see the closed socket.
	let literalTooLarge = false;
	client.on("error", error => { literalTooLarge = "code" in error && error.code === "LiteralTooLarge"; });
	const close = () => client.close();
	signal.addEventListener("abort", close, { once: true });
	try {
		await client.connect();
		signal.throwIfAborted();
		const lock = await client.getMailboxLock("INBOX", { readOnly: true });
		try { return await work(client); }
		finally { lock.release(); }
	} catch (error) {
		signal.throwIfAborted();
		if (literalTooLarge || (error instanceof Error && "code" in error && error.code === "LiteralTooLarge")) throw new QqMailReadError(OVERSIZE);
		throw error;
	} finally { signal.removeEventListener("abort", close); close(); }
}

function validity(client: ImapFlow): string {
	if (!client.mailbox) throw new QqMailReadError("无法打开 QQ 邮箱收件箱。");
	return client.mailbox.uidValidity.toString();
}

export const qqMailTransport: QqMailTransport = {
	async verify(auth, signal) {
		await useImap(auth, signal, async () => {});
		signal.throwIfAborted();
		const client = smtp(auth);
		try { await client.verify(); }
		finally { client.close(); }
		signal.throwIfAborted();
	},
	async search(auth, search, signal) {
		return useImap(auth, signal, async client => {
			const uidValidity = validity(client);
			const { limit, since, unread, ...filters } = search;
			const ids = await client.search({ all: true, ...filters, ...(since ? { since: new Date(`${since}T00:00:00Z`) } : {}), ...(unread ? { seen: false } : {}) }, { uid: true });
			if (!ids || !ids.length) return [];
			const newest = ids.sort((a, b) => b - a).slice(0, limit).join(",");
			const mails = await client.fetchAll(newest, { envelope: true }, { uid: true });
			signal.throwIfAborted();
			return mails.sort((a, b) => b.uid - a.uid).map(mail => ({ ref: { uid: mail.uid, uidValidity }, subject: mail.envelope?.subject ?? "", from: mail.envelope?.from ?? [], date: mail.envelope?.date }));
		});
	},
	async read(auth, ref, signal) {
		return useImap(auth, signal, async client => {
			if (validity(client) !== ref.uidValidity) throw new QqMailReadError("收件箱已变化，请重新搜索邮件。");
			// Request the entire BODY.PEEK[] literal. The protocol parser checks its framing
			// and length; RFC822.SIZE metadata can disagree with the bytes sent by the server.
			const message = await client.fetchOne(String(ref.uid), { source: true }, { uid: true });
			signal.throwIfAborted();
			if (!message || !message.source?.length) throw new QqMailReadError("这封邮件已不存在或不可读取。");
			const parsed = await simpleParser(message.source, { skipImageLinks: true, skipTextToHtml: true });
			signal.throwIfAborted();
			return { subject: parsed.subject ?? "", from: parsed.from?.value ?? [], date: parsed.date, text: parsed.text ?? "", messageId: parsed.messageId, attachments: parsed.attachments };
		});
	},
	async send(auth, mail, signal) {
		signal.throwIfAborted();
		const client = smtp(auth);
		try {
			const message = { from: auth.address, to: mail.to.map(address => ({ address, name: "" })), cc: mail.cc.map(address => ({ address, name: "" })),
				subject: mail.subject, text: mail.text, inReplyTo: mail.inReplyTo, references: mail.inReplyTo, attachments: mail.attachments, signal };
			// The SMTP pool cancels queued and in-flight mail via the message signal.
			const result = await client.sendMail(message);
			return { messageId: result.messageId, accepted: result.accepted.map(String), rejected: result.rejected.map(String) };
		} finally { client.close(); }
	},
};
