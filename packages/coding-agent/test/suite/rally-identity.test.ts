import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IdentityStore } from "../../../../src/main/identity-store.ts";
import { DEFAULT_IDENTITY } from "../../../../src/shared/identity.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally persisted identity", () => {
	const harnesses: Harness[] = [];
	afterEach(() => harnesses.splice(0).forEach(harness => harness.cleanup()));
	async function setup() { const harness = await createHarness(); harnesses.push(harness); const home = join(harness.tempDir, "identity-home"); return { home, store: new IdentityStore(home) }; }
	it("migrates old display preferences once and persists independent partial changes", async () => {
		const { home, store } = await setup();
		expect(store.state()).toEqual(DEFAULT_IDENTITY);
		store.initialize({ name: " 小莱 ", personality: "平实", workstyle: "先解释" });
		store.update({ personality: "直截了当" });
		const restored = new IdentityStore(home);
		expect(restored.initialize({ name: "旧缓存", personality: "旧性格", workstyle: "旧方式" })).toEqual({ name: "小莱", personality: "直截了当", workstyle: "先解释", avatar: null });
		const copy = restored.state(); copy.name = "不应回写";
		expect(restored.state().name).toBe("小莱");
	});
	it("rejects invalid updates atomically and preserves malformed disk evidence", async () => {
		const { home, store } = await setup(); store.update({ name: "保留" }); const original = readFileSync(join(home, "identity.json"));
		for (const patch of [null, [], { name: " " }, { name: "长".repeat(41) }, { personality: "长".repeat(2001) }, { workstyle: false }, { avatar: "https://example.invalid/avatar" }, { tools: ["shell"] }, JSON.parse('{"__proto__":"bad"}')]) expect(() => store.update(patch)).toThrow();
		expect(readFileSync(join(home, "identity.json"))).toEqual(original); expect(store.state().name).toBe("保留");
		writeFileSync(join(home, "identity.json"), "broken"); expect(() => new IdentityStore(home)).toThrow(); expect(readFileSync(join(home, "identity.json"), "utf8")).toBe("broken");
	});
	it("retains settings on a failed save and keeps avatar bytes out of model context", async () => {
		const { home, store } = await setup(); store.update({ name: "原名" });
		mkdirSync(join(home, "identity.json.tmp")); expect(() => store.update({ name: "未保存" })).toThrow(); expect(store.state().name).toBe("原名");
		expect(store.context()).toContain('"name":"原名"'); expect(store.context()).not.toContain('"avatar"');
		for (const avatar of ["data:image/svg+xml;base64,PHN2Zz4=", "file:///secret", "https://example.invalid/icon.png", "data:image/png;base64,AAAA"]) expect(() => store.setAvatar(avatar)).toThrow();
	});
});
