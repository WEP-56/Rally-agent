import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpStore } from "../../../src/main/mcp-store.ts";
import { setProjectTrust } from "../../../src/main/project-trust.ts";
import { getMcpToolExposure } from "../src/core/mcp-servers.ts";
import type { McpExposure } from "../../../src/shared/mcp.ts";
import { CapabilityCatalog } from "../../../src/main/supervisor/capability-catalog.ts";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function setup() {
	const directory = mkdtempSync(join(tmpdir(), "rally-mcp-settings-")); directories.push(directory);
	const store = new McpStore(directory);
	store.save(JSON.stringify({ custom: "keep", mcpServers: {
		fixture: { command: "must-not-execute", args: ["a b"], env: { KEY: "!must-not-execute" }, toolExposure: { "read_*": "direct", "*": "hidden" } },
		remote: { url: "https://example.invalid/mcp", headers: { Authorization: "literal-secret" }, enabled: false, exposure: "codemode-deferred" },
	} }));
	return { store, directory };
}

describe("MCP disclosure settings", () => {
	it("bounds routing summaries and excludes connection details and disabled servers", async () => {
		const { store, directory } = setup();
		store.save(JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [
			`server_${index}`, { command: "NEVER_RUN_COMMAND", args: ["PRIVATE_ARGUMENT"], description: "能力说明".repeat(80), env: { SECRET: "PRIVATE_TOKEN" }, enabled: index !== 59 },
		])) }));
		const context = await new CapabilityCatalog(directory, () => [directory]).context();
		const json = JSON.parse(context.slice(context.indexOf("\n") + 1));
		expect(JSON.stringify(json.mcp).length).toBeLessThan(2500);
		expect(json.mcp.entries.length).toBeGreaterThan(0); expect(json.mcp.omitted).toBeGreaterThan(0);
		for (const secret of ["NEVER_RUN_COMMAND", "PRIVATE_ARGUMENT", "PRIVATE_TOKEN", "server_59"]) expect(context).not.toContain(secret);
	});
	it("adds and edits individual servers without overwriting existing entries", () => {
		const { store } = setup();
		store.saveServer("second", JSON.stringify({ command: "never-run", args: ["two"], description: "Second server" }));
		expect(store.state().servers.map(server => server.name)).toEqual(["fixture", "remote", "second"]);
		const before = JSON.parse(store.state().json);
		store.saveServer("renamed", JSON.stringify({ url: "https://example.invalid/new" }), "second");
		const after = JSON.parse(store.state().json);
		expect(after.custom).toBe("keep");
		expect(after.mcpServers.fixture).toEqual(before.mcpServers.fixture);
		expect(after.mcpServers.remote).toEqual(before.mcpServers.remote);
		expect(after.mcpServers.second).toBeUndefined();
		expect(after.mcpServers.renamed).toEqual({ url: "https://example.invalid/new" });
		const saved = store.state().json;
		for (const action of [() => store.saveServer("fixture", '{"command":"overwrite"}'), () => store.saveServer("broken", '{}'), () => store.saveServer("x", '{"command":"x"}', "missing")]) {
			expect(action).toThrow(); expect(store.state().json).toBe(saved);
		}
	});
	it("persists server defaults and tool rules without losing fields or changing risk tiers", () => {
		const { store, directory } = setup();
		expect(store.state().servers.map(server => server.exposure)).toEqual(["direct", "codemode"]);
		store.setTier("mcp__fixture__read_issues", "irreversible");
		store.setExposure("fixture", "deferred");
		store.setExposure("fixture", "deferred", "read_issues");
		const restored = new McpStore(directory);
		expect(restored.state().servers[0]).toMatchObject({ exposure: "deferred", toolExposure: { "read_*": "direct", "*": "hidden", read_issues: "deferred" } });
		const config = restored.forProject(directory).servers[0].config;
		expect(getMcpToolExposure(config, "read_issues")).toBe("deferred");
		expect(getMcpToolExposure(config, "read_docs")).toBe("direct");
		expect(getMcpToolExposure(config, "delete")).toBe("hidden");
		expect(restored.tier("mcp__fixture__read_issues")).toBe("irreversible");
		expect(JSON.parse(restored.state().json)).toMatchObject({ custom: "keep", mcpServers: {
			fixture: { command: "must-not-execute", args: ["a b"], env: { KEY: "!must-not-execute" } },
			remote: { headers: { Authorization: "literal-secret" }, enabled: false, exposure: "codemode-deferred" },
		} });
		restored.setExposure("fixture", null, "read_issues");
		expect(getMcpToolExposure(restored.forProject(directory).servers[0].config, "read_issues")).toBe("direct");
		restored.setExposure("fixture", null); expect(restored.state().servers[0].exposure).toBe("direct");
		expect(JSON.parse(restored.state().json).mcpServers.fixture.exposure).toBeUndefined();
	});
	it("rejects malformed updates and preserves an invalid configuration instead of overwriting it", () => {
		const { store, directory } = setup(); const original = store.state().json;
		for (const operation of [
			() => store.setExposure("missing", "deferred"),
			() => store.setExposure("fixture", "invalid" as McpExposure),
			() => store.setExposure("fixture", "deferred", "  "),
			() => store.setExposure("fixture", "deferred", 4 as unknown as string),
		]) { expect(operation).toThrow(); expect(store.state().json).toBe(original); }
		writeFileSync(join(directory, "mcp.json"), "{broken");
		expect(() => store.setExposure("fixture", "deferred")).toThrow();
		expect(readFileSync(join(directory, "mcp.json"), "utf8")).toBe("{broken");
	});
	it("keeps trusted project overrides local and ignores them after trust is revoked", () => {
		const { store, directory } = setup(); const project = join(directory, "project"); mkdirSync(join(project, ".rally"), { recursive: true });
		store.setExposure("fixture", "deferred");
		const file = join(project, ".rally", "mcp.json");
		const content = JSON.stringify({ mcpServers: { fixture: { exposure: "hidden", toolExposure: { read_issues: "direct" } } } }); writeFileSync(file, content);
		setProjectTrust(directory, project, true);
		expect(store.forProject(project).servers[0].config.exposure).toBe("hidden");
		store.setExposure("fixture", "codemode");
		expect(readFileSync(file, "utf8")).toBe(content);
		expect(store.forProject(project).servers[0].config.exposure).toBe("hidden");
		setProjectTrust(directory, project, false);
		expect(store.forProject(project).servers[0].config.exposure).toBe("codemode");
	});
});
