import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fauxAssistantMessage, type TranscriptContext } from "@rally/ai";
import { DefaultResourceLoader } from "../../src/index.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ChatRequests } from "../../../../src/main/cloud/requests.ts";
import { INACTIVITY_TIMEOUT } from "../../../../src/main/supervisor/inactivity.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText } from "./harness.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
}, 30000);

async function fixture(start = true) {
	vi.stubEnv("PI_OFFLINE", "1");
	const harness = await createHarness({ provider: "inbox-test", models: [{ id: "main" }] });
	const paths = resolveRallyPaths(join(harness.tempDir, "home"));
	ensureRallyDirs(paths);
	writeFileSync(join(paths.agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
	cleanups.push(() => harness.cleanup());
	let now = Date.now();
	const open = async (started = true) => {
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, inactivityNow: () => now });
		cleanups.push(() => supervisor.dispose());
		await supervisor.models.save([{ id: "inbox-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux", models: [defaultModel("main")] }]);
		const runtime = (await supervisor.models.whenReady())!;
		runtime.registerProvider("inbox-test", { api: harness.faux.api, apiKey: "faux", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "inbox-test", model: "main", thinkingLevel: "off" });
		if (started) await supervisor.start();
		return supervisor;
	};
	const supervisor = await open(start);
	return { supervisor, harness, paths, open, advance: (ms: number) => { now += ms; } };
}

function current(context: TranscriptContext): string { return getMessageText(context.messages.findLast(message => message.role === "user")!); }
function users(supervisor: Supervisor) { return supervisor.main.state().messages.filter(line => line.role === "user"); }
async function done(supervisor: Supervisor, count: number) {
	await vi.waitFor(() => expect(users(supervisor).filter(line => line.delivery?.status === "done")).toHaveLength(count));
}
function barrier() {
	const hold = Promise.withResolvers<void>();
	cleanups.push(() => hold.resolve());
	return hold;
}

const qq = { platform: "qq" as const, appId: "12345", chatId: "owner", messageId: "qq-1" };
const feishu = { platform: "feishu" as const, appId: "cli_fixture", chatId: "chat", senderId: "ou_owner", messageId: "fs-1" };

describe("durable user inbox (offline production sessions)", () => {
	it("saves simultaneous desktop, QQ and Feishu inputs, runs FIFO, and routes each reply to its own source", async () => {
		const { supervisor, harness } = await fixture();
		const entered = barrier(), release = barrier();
		const seen: string[] = [];
		vi.spyOn(supervisor.qqBot, "canReply").mockReturnValue(true);
		vi.spyOn(supervisor.feishu, "canReply").mockReturnValue(true);
		const qqReply = vi.spyOn(supervisor.qqBot, "reply").mockResolvedValue();
		const fsReply = vi.spyOn(supervisor.feishu, "reply").mockResolvedValue();
		harness.setResponses([
			async context => { seen.push(current(context)); entered.resolve(); await release.promise; expect(JSON.stringify(context.messages)).not.toContain("QQ_SECOND"); return fauxAssistantMessage("desktop reply"); },
			context => { seen.push(current(context)); return fauxAssistantMessage("QQ reply"); },
			context => { seen.push(current(context)); return fauxAssistantMessage("Feishu reply"); },
		]);
		await supervisor.main.send("DESKTOP_FIRST"); await entered.promise;
		await Promise.all([supervisor.main.receiveFromIm("QQ_SECOND", qq), supervisor.main.receiveFromIm("FEISHU_THIRD", feishu)]);
		await supervisor.main.receiveFromIm("duplicate", qq);
		expect(users(supervisor).map(line => line.delivery?.status)).toEqual(["processing", "queued", "queued"]);
		expect(supervisor.main.quote({ id: users(supervisor)[1].id })).toBeNull();
		expect(supervisor.main.search({ query: "QQ_SECOND" }).messages).toHaveLength(0);
		release.resolve(); await done(supervisor, 3);
		await vi.waitFor(() => expect(fsReply).toHaveBeenCalledExactlyOnceWith(feishu, "Feishu reply"));
		expect(qqReply).toHaveBeenCalledExactlyOnceWith(qq, "QQ reply");
		expect(seen.map(text => text.split("\n")[1])).toEqual(["DESKTOP_FIRST", "QQ_SECOND", "FEISHU_THIRD"]);
		const lines = supervisor.main.state().messages;
		for (const [i, text] of ["desktop reply", "QQ reply", "Feishu reply"].entries()) expect(lines.find(line => line.text === text)?.replyTo).toBe(users(supervisor)[i].id);
	});

	it("withdraws queued messages before inference and rejects a fresh conversation while intake is pending", async () => {
		const { supervisor, harness } = await fixture();
		const entered = barrier(), release = barrier();
		harness.setResponses([async () => { entered.resolve(); await release.promise; return fauxAssistantMessage("first done"); }, fauxAssistantMessage("third done")]);
		await supervisor.main.send("first"); await entered.promise;
		await supervisor.main.send("cancel me"); await supervisor.main.send("third");
		await expect(supervisor.main.newConversation()).rejects.toThrow();
		await supervisor.main.updateInbox({ action: "cancel", id: users(supervisor)[1].id });
		release.resolve(); await done(supervisor, 2);
		expect(users(supervisor).map(line => line.delivery?.status)).toEqual(["done", "cancelled", "done"]);
		expect(supervisor.main.recentContext(3).filter(entry => entry.source === "chat").map(entry => entry.text)).toEqual(["first", "first done", "third", "third done"]);
	});

	it("restores queued attachments and cloud idempotency after a restart before any model admission", async () => {
		const { supervisor, harness, paths, open } = await fixture(false);
		const file = join(paths.workspaceDir, "note.txt"); writeFileSync(file, "attachment snapshot");
		const resource = await supervisor.resources.importFile("desktop", file, [paths.workspaceDir]);
		const request = randomUUID();
		await supervisor.main.send("remember attachment", [resource.id], "desktop", request);
		await supervisor.main.send("second queued");
		expect(users(supervisor).every(line => line.delivery?.status === "queued")).toBe(true);
		await supervisor.dispose();
		harness.setResponses([context => { expect(current(context)).toContain(resource.id); return fauxAssistantMessage("attachment received"); }, fauxAssistantMessage("second received")]);
		const restored = await open();
		await restored.main.send("remember attachment", [resource.id], "desktop", request);
		await done(restored, 2);
		expect(users(restored)).toHaveLength(2);
		expect(users(restored)[0].attachments?.[0].id).toBe(resource.id);
	});

	it("keeps interrupted work visible without rerunning it on restart, then honors an explicit retry", async () => {
		const { supervisor, harness, open } = await fixture();
		const entered = barrier();
		harness.setResponses([async (_context, options) => {
			entered.resolve(); await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
			return fauxAssistantMessage("", { stopReason: "aborted" });
		}]);
		await supervisor.main.send("interrupted original"); await entered.promise;
		await supervisor.main.send("later message");
		const id = users(supervisor)[0].id;
		await supervisor.dispose();
		harness.setResponses([context => { expect(current(context)).toContain("<rally-retry>"); expect(current(context)).toContain(id); return fauxAssistantMessage("recovered"); }, fauxAssistantMessage("later reply")]);
		const restored = await open();
		expect(users(restored).map(line => line.delivery?.status)).toEqual(["failed", "queued"]);
		expect(restored.main.state().inboxPaused).toBe(true);
		await restored.main.updateInbox({ action: "retry", id });
		await done(restored, 2);
	});

	it("stop pauses subsequent messages until explicit resume, without discarding queued input", async () => {
		const { supervisor, harness } = await fixture();
		const entered = barrier();
		harness.setResponses([async (_context, options) => {
			entered.resolve(); await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
			return fauxAssistantMessage("", { stopReason: "aborted" });
		}, fauxAssistantMessage("second done")]);
		await supervisor.main.send("first"); await entered.promise; await supervisor.main.send("second");
		await supervisor.main.abort();
		await vi.waitFor(() => expect(users(supervisor)[0].delivery?.status).toBe("failed"));
		expect(users(supervisor)[1].delivery?.status).toBe("queued");
		await supervisor.main.updateInbox({ action: "resume" }); await done(supervisor, 1);
	});

	it("retains IM replies offline across restart and retries delivery without a second model call", async () => {
		const { supervisor, harness, open } = await fixture();
		harness.setResponses([fauxAssistantMessage("saved reply")]);
		await supervisor.main.receiveFromIm("hello QQ", qq); await done(supervisor, 1);
		expect(users(supervisor)[0].delivery?.reply?.status).toBe("pending");
		await supervisor.dispose();
		harness.setResponses([]);
		const restored = await open();
		vi.spyOn(restored.qqBot, "canReply").mockReturnValue(true);
		const reply = vi.spyOn(restored.qqBot, "reply").mockRejectedValueOnce(Error("offline failure")).mockResolvedValue();
		restored.main.available();
		await vi.waitFor(() => expect(users(restored)[0].delivery?.reply?.status).toBe("failed"));
		await restored.main.updateInbox({ action: "retry", id: users(restored)[0].id });
		await vi.waitFor(() => expect(users(restored)[0].delivery?.reply?.status).toBe("sent"));
		expect(reply).toHaveBeenCalledTimes(2);
		expect(restored.main.state().messages.filter(line => line.role === "assistant")).toHaveLength(1);
		await restored.main.receiveFromIm("duplicate", qq);
		expect(users(restored)).toHaveLength(1);
	});

	it("keeps the queue behind the 72-hour guard, and resumes only after new speech", async () => {
		const { supervisor, harness, advance } = await fixture();
		harness.setResponses([fauxAssistantMessage("first reply")]);
		await supervisor.main.send("first"); await done(supervisor, 1);
		advance(INACTIVITY_TIMEOUT);
		expect(supervisor.inactivity.canRun()).toBe(false);
		await expect(supervisor.main.updateInbox({ action: "resume" })).rejects.toThrow("闲置保护");
		harness.setResponses([fauxAssistantMessage("awake reply")]);
		await supervisor.main.receiveFromIm("new speech", qq); await done(supervisor, 2);
		expect(supervisor.inactivity.canRun()).toBe(true);
	});

	it("recovers a cloud acknowledgement gap using the durable message key", async () => {
		const { supervisor, paths } = await fixture(false);
		const file = join(paths.stateDir, "requests-test.sqlite");
		let requests = new ChatRequests(file);
		const id = randomUUID();
		await expect(requests.run("device", id, ["hello"], async () => {
			await supervisor.main.send("hello", [], "device", id); throw Error("lost acknowledgement");
		}, true)).rejects.toThrow("lost acknowledgement");
		requests.db.close(); requests = new ChatRequests(file);
		try {
			await requests.run("device", id, ["hello"], () => supervisor.main.send("hello", [], "device", id), true);
			expect(users(supervisor)).toHaveLength(1);
			await expect(requests.run("device", id, ["different"], async () => {}, true)).rejects.toThrow("不同消息");
		} finally { requests.db.close(); }
	});

	it("pauses after a final model error instead of spending on repeated automatic attempts", async () => {
		const { supervisor, harness } = await fixture();
		const entered = barrier(), release = barrier();
		let attempts = 0;
		harness.setResponses([async () => {
			attempts++; entered.resolve(); await release.promise;
			return fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture provider unavailable" });
		}, () => { attempts++; return fauxAssistantMessage("later done"); }]);
		await supervisor.main.send("will fail"); await entered.promise;
		await supervisor.main.send("later"); release.resolve();
		await vi.waitFor(() => expect(users(supervisor)[0].delivery?.status).toBe("failed"));
		expect(users(supervisor)[0].delivery?.error).toContain("fixture provider unavailable");
		expect(supervisor.main.state().inboxPaused).toBe(true);
		supervisor.main.available();
		expect(attempts).toBe(1);
		await supervisor.main.updateInbox({ action: "resume" }); await done(supervisor, 1);
		expect(attempts).toBe(2);
	});

	it("retains messages without a configured model, and permits withdrawal without inference", async () => {
		const { supervisor, harness } = await fixture();
		await supervisor.models.save([]);
		await supervisor.main.reapplyActiveModel();
		harness.setResponses([]);
		await supervisor.main.send("wait for a model");
		expect(supervisor.main.state().model).toBeNull();
		expect(users(supervisor)[0].delivery?.status).toBe("queued");
		await expect(supervisor.main.newConversation()).rejects.toThrow("收件箱");
		await supervisor.main.updateInbox({ action: "cancel", id: users(supervisor)[0].id });
		expect(users(supervisor)[0].delivery?.status).toBe("cancelled");
	});

	it("does not lose a message that arrives while a new conversation is loading", async () => {
		const { supervisor, harness } = await fixture();
		const entered = barrier(), release = barrier();
		const reload = DefaultResourceLoader.prototype.reload;
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementationOnce(async function (this: DefaultResourceLoader) {
			await reload.call(this); entered.resolve(); await release.promise;
		});
		const replacing = supervisor.main.newConversation();
		const rejected = expect(replacing).rejects.toThrow("收件箱");
		await entered.promise;
		harness.setResponses([fauxAssistantMessage("preserved reply")]);
		await supervisor.main.send("arrived during reset");
		release.resolve(); await rejected; await done(supervisor, 1);
		expect(users(supervisor)[0].text).toBe("arrived during reset");
		expect(supervisor.events.ofKind("chat_reset")).toHaveLength(0);
	});
});
