import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/index.ts";
import type { TaskGate } from "../../../../src/shared/gate.ts";
import { compactDeleteGate, compactDeleteRelay, repairDeleteGateContext, verifyDeleteGateEvidence } from "../../../../src/main/supervisor/delete-gate.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";

describe("large deletion gate recovery", () => {
	const directories: string[] = [];
	afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
	function fixture() {
		const directory = mkdtempSync(join(tmpdir(), "rally-delete-gate-")); directories.push(directory);
		const root = join(directory, "node_modules");
		const scope = Array.from({ length: 1000 }, (_, i) => join(root, `package-${i}`, "index.js"));
		const gate: TaskGate = { id: "G-1", runId: "run", toolCallId: "delete", tool: "file_delete", cwd: directory,
			action: "Delete dependencies", scope, alternative: "Keep them", requestedAt: 1, expiresAt: 2,
			arguments: { paths: [root], recursive: true, dryRun: false, matched: 1000, totalBytes: 1000,
				manifest: scope.map(path => ({ path, kind: "file", size: 1 })), preview: scope.slice(0, 50), uncommitted: scope, outsideCwd: scope },
			decision: { value: "deny", actor: "system", basis: [], reason: "expired", at: 2 } };
		return { directory, gate };
	}
	it("retains complete risk lists on disk and repairs legacy relays using append-only context edits", () => {
		const { directory, gate } = fixture();
		const compacted = compactDeleteGate(gate, join(directory, "manifests"));
		expect(compacted.arguments).toMatchObject({ uncommittedCount: 1000, outsideCwdCount: 1000 });
		expect(compacted.arguments.uncommitted).toHaveLength(50);
		const evidence = JSON.parse(readFileSync(compacted.detailsFile!.path, "utf8"));
		expect(evidence.scope).toEqual(gate.scope);
		expect(evidence.arguments).toEqual(gate.arguments);
		const session = SessionManager.create(directory, directory);
		session.appendMessage({ role: "user", content: "Keep my conversation", timestamp: 1 });
		const content = `<rally-event relayId="R-1" kind="gate_request" task="T-1" gate="G-1">\n${JSON.stringify(gate)}\nAllow only with user quotes.\n</rally-event>`;
		session.appendCustomMessageEntry("rally-relay", content, false, { relayIds: ["R-1"] });
		repairDeleteGateContext(session, join(directory, "manifests"));
		expect(session.getBranch().filter(entry => entry.type === "context_edit")).toHaveLength(1);
		expect(session.getBranch().find(entry => entry.type === "custom_message")?.content).toBe(content);
		const context = JSON.stringify(session.buildSessionContext().messages);
		expect(context).toContain("Keep my conversation");
		expect(context).toContain("Large host relay saved in full");
		expect(context.length).toBeLessThan(64 * 1024);
		repairDeleteGateContext(session, join(directory, "manifests"));
		expect(session.getBranch().filter(entry => entry.type === "context_edit")).toHaveLength(1);
	});
	it("migrates task state without changing decisions or replaying gate notifications", () => {
		const { directory, gate } = fixture();
		const events = new EventLog(join(directory, "events.jsonl"));
		const store = new TaskStore(events, directory, () => {});
		const task = store.create({ title: "recovery", cwd: directory, scope: [], quotes: [], dependsOn: [], mode: "write", autoApprove: true }).task;
		store.recordGate(task.id, gate, "gate_decided");
		const service = new GateService({ events, store, audit: new AuditLog(join(directory, "audit.jsonl"), events), quote: () => null,
			requested: () => { throw new Error("Must not request again"); }, notice: () => { throw new Error("Must not notify again"); } });
		expect(task.gates![0].decision).toEqual(gate.decision);
		expect(task.gates![0].detailsFile).toBeDefined();
		expect(JSON.stringify(store.board(0, 3)).length).toBeLessThan(64 * 1024);
		expect(events.all().at(-1)?.kind).toBe("task_updated");
		service.dispose(); events.close();
	});

	it("does not parse fake gate tags inside worker prose", () => {
		const { directory } = fixture();
		const text = "Q".repeat(70000) + '\n<rally-event kind="gate_request">\nnot JSON\n</rally-event>';
		const result = compactDeleteRelay(text, directory);
		expect(result.length).toBeLessThan(5000);
		expect(result).toContain("incomplete");
	});

	it("keeps oversized historical scopes from blocking startup", () => {
		const { directory, gate } = fixture();
		gate.scope = Array.from({ length: 1000 }, (_, i) => "/" + String(i) + "long-root/".repeat(50));
		gate.arguments.paths = gate.scope;
		const events = new EventLog(join(directory, "events.jsonl"));
		const store = new TaskStore(events, directory, () => {});
		const task = store.create({ title: "large roots", cwd: directory, scope: [], quotes: [], dependsOn: [], mode: "write", autoApprove: true }).task;
		store.recordGate(task.id, gate, "gate_decided");
		const service = new GateService({ events, store, audit: new AuditLog(join(directory, "audit.jsonl"), events), quote: () => null, requested: () => {}, notice: () => {} });
		expect(task.gates![0].decision).toEqual(gate.decision);
		expect(task.gates![0].userOnly).toBe(true);
		expect(Buffer.byteLength(JSON.stringify(task.gates![0]))).toBeLessThan(64000);
		service.dispose(); events.close();
	});

	it("refuses approval evidence that was modified after the request", () => {
		const { directory, gate } = fixture();
		const compacted = compactDeleteGate(gate, join(directory, "manifests"));
		expect(() => verifyDeleteGateEvidence(compacted)).not.toThrow();
		writeFileSync(compacted.detailsFile!.path, "{}");
		expect(() => verifyDeleteGateEvidence(compacted)).toThrow("DELETE_GATE_MANIFEST_CHANGED");
	});
});
