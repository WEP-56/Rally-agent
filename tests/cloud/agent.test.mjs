import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("packaged headless agent executes a complete task with an offline faux provider", { timeout: 60000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "rally-cloud-agent-"));
	const child = spawn(process.env.RALLY_TEST_SERVER ? join(process.env.RALLY_TEST_SERVER, "bin/node") : process.execPath, ["--input-type=module"], {
		cwd: resolve(process.env.RALLY_TEST_SERVER ?? "out/server"),
		env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, PI_OFFLINE: "1" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
	try {
		child.stdin.end(readFileSync(new URL("./agent-fixture.mjs", import.meta.url)));
		const [code] = await once(child, "exit");
		assert.equal(code, 0, output);
		assert.match(output, /main relay passed/);
	} finally { if (child.exitCode === null) child.kill(); rmSync(dir, { recursive: true, force: true }); }
});
