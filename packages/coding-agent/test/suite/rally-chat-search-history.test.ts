import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelStore } from "../../../../src/main/model-store.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { MainAgent } from "../../../../src/main/supervisor/main-agent.ts";

describe("Rally chat search history", () => {
	const cleanups: (() => void)[] = [];
	afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

	it("still finds messages from before a new conversation and a restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "rally-chat-history-"));
		cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
		const paths = resolveRallyPaths(directory);
		ensureRallyDirs(paths);
		const events = new EventLog(paths.eventsFile);
		cleanups.push(() => events.close());
		events.append("chat_message", { n: 366, role: "assistant", at: 1_000, text: "重启前的回答" });
		events.append("chat_message", { n: 367, role: "user", at: 2_000, text: "issues 都关" });
		events.append("chat_reset", { conversationId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
		events.append("chat_message", { n: 370, role: "user", at: 3_000, text: "我回来了" });

		// A restart replays the log from the last reset, so only the current conversation is live.
		const models = new ModelStore(paths.modelsFile); await models.whenReady();
		const main = new MainAgent(paths, events, () => {}, { models });
		cleanups.push(() => { void main.dispose(); });
		expect(main.state().messages.map(line => line.id)).toEqual(["#370"]);
		expect(main.search({ id: "#367" }).messages.map(message => message.text)).toEqual(["issues 都关"]);
		expect(main.search({ query: "issues" }).messages.map(message => message.id)).toEqual(["#367"]);
		expect(main.search({ aroundId: "#367", limit: 3 }).messages.map(message => message.id)).toEqual(["#370", "#367", "#366"]);
		expect(main.search({ id: "#370" }).messages[0].quotable).toBe(true);
		expect(main.search({ id: "#367" }).messages[0].quotable).toBe(false);
		expect(main.quote({ id: "#367" })).toBeNull();
	});
});
