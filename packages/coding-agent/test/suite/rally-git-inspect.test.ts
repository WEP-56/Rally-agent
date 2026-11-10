import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "../../src/index.ts";
import { createGitInspectTool, inspectArgs, type GitReadCommand } from "../../../../src/main/supervisor/git-inspect.ts";
import { runGit } from "../../../../src/main/supervisor/git-runner.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally git_inspect (offline local repositories)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.restoreAllMocks(); vi.unstubAllEnvs();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const cwd = join(harness.tempDir, "项目 with spaces"); mkdirSync(cwd);
		execFileSync("git", ["init", cwd], { windowsHide: true, stdio: "ignore" });
		const logs = join(harness.tempDir, "logs");
		let base = cwd;
		const tool = createGitInspectTool(() => base, logs);
		const call = (command: GitReadCommand, args: string[] = [], dir?: string, signal?: AbortSignal) => tool.execute("inspect", { command, args, cwd: dir }, signal, undefined, {} as ExtensionToolContext);
		return { cwd, logs, harness, call, setBase: (dir: string) => { base = dir; } };
	}

	it("queries status and staged diff without touching the index or invoking configured helpers", async () => {
		const { cwd, call } = await setup();
		writeFileSync(join(cwd, "sample.txt"), "before\n");
		execFileSync("git", ["-C", cwd, "add", "--", "sample.txt"], { windowsHide: true });
		const index = join(cwd, ".git", "index"); const content = readFileSync(index); const mtime = statSync(index).mtimeMs;
		writeFileSync(join(cwd, ".gitattributes"), "sample.txt diff=fixture\n");
		execFileSync("git", ["-C", cwd, "config", "diff.fixture.textconv", "must-not-run"], { windowsHide: true });
		execFileSync("git", ["-C", cwd, "config", "diff.external", "must-not-run"], { windowsHide: true });
		execFileSync("git", ["-C", cwd, "config", "core.fsmonitor", "must-not-run"], { windowsHide: true });
		writeFileSync(join(cwd, "sample.txt"), "after\n");
		const status = await call("status", ["--short"]); expect(status.details.exitCode).toBe(0); expect(status.details.output).toContain("AM sample.txt");
		const diff = await call("diff"); expect(diff.details.exitCode).toBe(0); expect(diff.details.output).toContain("+after"); expect(diff.details.output).not.toContain("must-not-run");
		const staged = await call("diff", ["--cached", "--", "sample.txt"]); expect(staged.details.output).toContain("+before");
		expect(readFileSync(index)).toEqual(content); expect(statSync(index).mtimeMs).toBe(mtime); expect(existsSync(`${index}.lock`)).toBe(false);
	});

	it("forces branch listing, preserves literal paths and never interprets shell syntax", async () => {
		const { cwd, call } = await setup();
		const refs = join(cwd, ".git", "refs", "heads");
		const result = await call("branch", ["proposed-branch"]); expect(result.details.exitCode).toBe(0);
		expect(existsSync(join(refs, "proposed-branch"))).toBe(false);
		writeFileSync(join(cwd, "--output=trap"), "literal");
		const literal = await call("status", ["--short", "--", "--output=trap"]); expect(literal.details.output).toContain("--output=trap");
		const injection = await call("status", ["--", "sample; touch injected"]); expect(injection.details.exitCode).toBe(0);
		expect(existsSync(join(cwd, "injected"))).toBe(false);
	});

	it("reads local history, blobs and branches without running a configured signature helper", async () => {
		const { cwd, logs, call } = await setup();
		// Write a deterministic repository fixture; no git commit or external signing.
		function object(type: string, body: Buffer): string {
			const data = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
			const hash = createHash("sha1").update(data).digest("hex");
			const dir = join(cwd, ".git", "objects", hash.slice(0, 2)); mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, hash.slice(2)), deflateSync(data)); return hash;
		}
		const blob = object("blob", Buffer.from("fixture content\n"));
		const tree = object("tree", Buffer.concat([Buffer.from("100644 tracked.txt\0"), Buffer.from(blob, "hex")]));
		const commit = object("commit", Buffer.from(`tree ${tree}\nauthor Fixture <fixture@localhost> 1 +0000\ncommitter Fixture <fixture@localhost> 1 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n Zml4dHVyZQ==\n -----END PGP SIGNATURE-----\n\nFixture history\n`));
		writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/fixture\n"); writeFileSync(join(cwd, ".git", "refs", "heads", "fixture"), `${commit}\n`);
		execFileSync("git", ["-C", cwd, "config", "gpg.program", "must-not-run"], { windowsHide: true });
		const history = await call("log", ["-n", "1", "--oneline"]); expect(history.details.exitCode).toBe(0); expect(history.details.output).toContain("Fixture history");
		expect((await call("show", ["HEAD:tracked.txt"])).details.output).toBe("fixture content\n");
		expect((await call("branch", ["--format=%(refname:short)"])).details.output.trim()).toBe("fixture");
		const baseline = await runGit(cwd, ["log", "-1", "--format=%G?"], { outputDir: logs }); expect(baseline.output).toContain("must-not-run");
		const signature = await call("log", ["-1", "--format=%G?"]); expect(signature.details.output).not.toContain("must-not-run");
		expect(readFileSync(join(cwd, ".git", "refs", "heads", "fixture"), "utf8")).toBe(`${commit}\n`);
	});

	it.each<[GitReadCommand, string[]]>([
		["branch", ["-D", "main"]], ["branch", ["-m", "old", "new"]], ["branch", ["-c", "copy"]], ["branch", ["--delete", "main"]],
		["branch", ["--format", "--", "-D", "main"]], ["branch", ["--points-at", "--", "--delete", "main"]],
		["diff", ["--output=trap"]], ["diff", ["--out", "trap"]], ["diff", ["-S", "--", "--output=trap"]], ["diff", ["--ext-diff"]], ["show", ["--textconv"]],
		["log", ["--pretty", "--output=trap"]], ["log", ["--format", "--", "--output=trap"]], ["log", ["--show-signature"]],
		["status", ["-C", "elsewhere"]], ["status", ["--git-dir=elsewhere"]], ["status", ["--unrecognized"]], ["status", ["bad\0path"]],
	])("rejects mutating or ambiguous %s arguments %j before execution", (command, args) => {
		expect(() => inspectArgs(command, args)).toThrow("READONLY_VIOLATION");
	});

	it("allows attached option values containing dashes and common history filters", () => {
		expect(inspectArgs("log", ["--format=--output=%H", "-n", "5", "--since=2026-01-01", "--", "path"])).toEqual([
			"log", "--no-ext-diff", "--no-textconv", "--format=--output=%H", "-n", "5", "--since=2026-01-01", "--", "path",
		]);
		expect(inspectArgs("branch", ["--format=%(refname:short)", "--list", "feature/*"])).toContain("--list");
	});

	it("resolves cwd at execution time and isolates inherited Git redirection and trace variables", async () => {
		const { cwd, harness, call, setBase } = await setup();
		const other = join(harness.tempDir, "other"); mkdirSync(other);
		execFileSync("git", ["init", other], { windowsHide: true, stdio: "ignore" });
		writeFileSync(join(cwd, "first.txt"), "first"); writeFileSync(join(other, "second.txt"), "second");
		vi.stubEnv("GIT_DIR", join(cwd, ".git")); vi.stubEnv("GIT_WORK_TREE", cwd); vi.stubEnv("GIT_INDEX_FILE", join(cwd, "redirected-index"));
		const trace = join(harness.tempDir, "must-not-write.log"); vi.stubEnv("GIT_TRACE", trace);
		setBase(other);
		const result = await call("status", ["--short"]); expect(result.details.output).toContain("second.txt"); expect(result.details.output).not.toContain("first.txt");
		const explicit = await call("status", ["--short"], cwd); expect(explicit.details.output).toContain("first.txt");
		expect(existsSync(trace)).toBe(false); expect(existsSync(join(cwd, "redirected-index"))).toBe(false);
		await expect(call("status", [], join(cwd, "first.txt"))).rejects.toThrow("GIT_CWD_INVALID");
	});

	it("keeps nonzero exit codes and spills full long output with intact head and tail", async () => {
		const { cwd, call } = await setup();
		writeFileSync(join(cwd, "first"), "START\n" + "old\n".repeat(16000) + "END\n");
		writeFileSync(join(cwd, "second"), "START\n" + "new\n".repeat(16000) + "END\n");
		const result = await call("diff", ["--no-index", "--", "first", "second"]);
		expect(result.details.exitCode).toBe(1); expect(result.isError).toBe(true);
		expect(result.details.output.length).toBeLessThan(30000); expect(result.details.output).toContain("diff --git"); expect(result.details.output).toContain(" END");
		expect(result.details.fullOutputPath).toBeTruthy();
		const full = readFileSync(result.details.fullOutputPath!, "utf8"); expect(full.length).toBeGreaterThan(60000); expect(full).toContain(" START"); expect(full).toContain(" END");
		const missing = await call("show", ["missing-revision"]); expect(missing.details.exitCode).not.toBe(0); expect(missing.isError).toBe(true);
	});

	it("cancels its own Git process tree and waits for child exit", async () => {
		const { cwd, logs, harness } = await setup();
		const pids = join(harness.tempDir, "pids.json"); const script = join(harness.tempDir, "wait.cjs");
		writeFileSync(script, `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);`);
		const controller = new AbortController();
		// A fixture-only alias creates a real descendant; git_inspect never accepts aliases or -c.
		const pending = runGit(cwd, ["-c", `alias.wait=!"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`, "wait"], { outputDir: logs, signal: controller.signal });
		const rejected = expect(pending).rejects.toThrow("GIT_ABORTED");
		try { await vi.waitFor(() => expect(existsSync(pids)).toBe(true), { timeout: 10000 }); }
		finally { controller.abort(); await rejected; }
		const ids = JSON.parse(readFileSync(pids, "utf8")) as number[];
		for (const pid of ids) await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 3000 });
	}, 15000);

	it("fails closed when complete output cannot be stored, and handles an already cancelled call", async () => {
		const { cwd, harness } = await setup();
		writeFileSync(join(cwd, "first"), "old\n".repeat(16000)); writeFileSync(join(cwd, "second"), "new\n".repeat(16000));
		const blocked = join(harness.tempDir, "not-a-directory"); writeFileSync(blocked, "keep");
		await expect(runGit(cwd, inspectArgs("diff", ["--no-index", "--", "first", "second"]), { readonly: true, outputDir: blocked })).rejects.toThrow();
		expect(readFileSync(blocked, "utf8")).toBe("keep");
		const controller = new AbortController(); controller.abort();
		await expect(runGit(cwd, ["status"], { readonly: true, outputDir: blocked, signal: controller.signal })).rejects.toThrow();
	});
});
