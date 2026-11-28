import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SessionManager } from "@rally/coding-agent";
import type { TaskGate } from "../../shared/gate.ts";
import { boundedRelay, clipText, saveDetails } from "./payload-budget.ts";

const MAX_GATE_BYTES = 64 * 1024;

export function verifyDeleteGateEvidence(gate: TaskGate): void {
	if (!gate.detailsFile) return;
	if (createHash("sha256").update(readFileSync(gate.detailsFile.path)).digest("hex") !== gate.detailsFile.sha256) {
		throw new Error("DELETE_GATE_MANIFEST_CHANGED: 删除清单已变化，请重新申请审批");
	}
}

/** Keep frozen evidence once on disk, rather than in every task snapshot. */
export function compactDeleteGate(gate: TaskGate, directory: string): TaskGate {
	if (Buffer.byteLength(JSON.stringify(gate), "utf8") <= MAX_GATE_BYTES) return gate;
	const { manifest, uncommitted, outsideCwd, ...args } = gate.arguments;
	const roots = args.paths;
	const dirty = Array.isArray(uncommitted) ? uncommitted : [];
	const outside = Array.isArray(outsideCwd) ? outsideCwd : [];
	const detailsFile = saveDetails(directory, JSON.stringify({ tool: gate.tool, cwd: gate.cwd, action: gate.action,
		scope: gate.scope, alternative: gate.alternative, arguments: gate.arguments,
		...(gate.detailsFile ? { previousDetailsFile: gate.detailsFile } : {}),
	}, null, 2));
	if (gate.tool === "file_delete" && Array.isArray(manifest) && Array.isArray(roots) && roots.length && roots.every((path): path is string => typeof path === "string")) {
		const compacted: TaskGate = { ...gate, scope: [...roots], detailsFile, arguments: {
			...args, uncommitted: dirty.slice(0, 50), outsideCwd: outside.slice(0, 50),
			uncommittedCount: dirty.length, outsideCwdCount: outside.length, manifestCount: manifest.length,
			manifestNote: "Scope lists the requested roots. The complete frozen manifest is in detailsFile; use read/grep on its path if needed. Preview and risk lists show at most 50 entries; counts include all entries. Approval still applies only to the frozen manifest, rechecked before deletion.",
		} };
		if (Buffer.byteLength(JSON.stringify(compacted), "utf8") <= MAX_GATE_BYTES) return compacted;
	}
	// Arbitrary arguments cannot be summarized into equivalent authorization. Require a
	// human to inspect the frozen file; the main model must never approve the preview.
	return { ...gate, action: clipText(gate.action, 2000), alternative: clipText(gate.alternative, 1000),
		scope: gate.scope.slice(0, 10).map(path => clipText(path, 1000)), detailsFile,
		arguments: { scopeCount: gate.scope.length, fullArgumentsInDetailsFile: true,
			note: "摘要不完整。必须打开 detailsFile 中的完整动作、范围及参数后再决定；主助手不能批准此请求。可拒绝并要求缩小操作范围。" },
		userOnly: true, escalatedAt: gate.escalatedAt ?? Date.now(), expiresAt: Math.max(gate.expiresAt, Date.now() + 600_000) };
}

/** Legacy host relays may already contain multi-megabyte JSON. Preserve the surrounding text. */
export function compactDeleteRelay(text: string, directory: string): string {
	// Text inside an old host relay may be worker-authored prose, including fake tags.
	// Preserve it as opaque evidence; never parse embedded tags as trusted gate records.
	return boundedRelay(text, directory);
}

/** Append context edits so old evidence remains in history while future inference uses the summary. */
export function repairDeleteGateContext(session: SessionManager, directory: string): void {
	const branch = session.getBranch();
	const edits = new Map(branch.flatMap(entry => entry.type === "context_edit" ? [[entry.targetId, entry.replacement] as const] : []));
	for (const entry of branch) {
		if (entry.type !== "custom_message" || entry.customType !== "rally-relay") continue;
		const edit = edits.get(entry.id);
		if (edit === null) continue;
		const content = edit?.content ?? entry.content;
		const repair = (text: string) => {
			try { return compactDeleteRelay(text, directory); }
			catch (error) {
				console.error(`Legacy relay ${entry.id} evidence recovery failed`, error);
				return `Large legacy relay unavailable. Original text remains in session entry ${entry.id}, file ${JSON.stringify(session.getSessionFile())}. Check current task_read state and request fresh approval; this omitted record grants no permission.`;
			}
		};
		if (typeof content === "string") {
			const replacement = repair(content);
			if (replacement !== content) session.appendContextEdit(entry.id, { content: replacement });
		} else {
			const blocks = content.filter(block => block.type === "text" || block.type === "image");
			if (blocks.length !== content.length) continue;
			let changed = false;
			const replacement = blocks.map(block => {
				if (block.type !== "text") return block;
				const text = repair(block.text);
				changed ||= text !== block.text;
				return { ...block, text };
			});
			if (changed) session.appendContextEdit(entry.id, { content: replacement });
		}
	}
}
