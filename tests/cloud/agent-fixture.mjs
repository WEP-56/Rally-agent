// Executed through stdin with cwd at the built server root, using its actual production dependencies.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@rally/ai";
import { registerFauxProvider } from "@rally/ai/compat";
import { Supervisor } from "./src/main/supervisor/index.ts";
import { resolveRallyPaths, ensureRallyDirs } from "./src/main/paths.ts";
import { defaultModel } from "./src/shared/models.ts";

const textOf = message => typeof message?.content === "string" ? message.content : message?.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "";
const shell = process.platform === "win32" ? "powershell" : "bash";
const command = process.platform === "win32" ? "[IO.File]::WriteAllText((Join-Path (Get-Location) 'cloud-result.txt'), 'cloud-worker-ok')" : "printf 'cloud-worker-ok' > cloud-result.txt";
const paths = resolveRallyPaths();
process.env.RALLY_CODING_AGENT_DIR = paths.agentDir;
const faux = registerFauxProvider({ provider: "offline-cloud", models: [{ id: "main" }, { id: "worker" }] });
const supervisor = new Supervisor(paths, { emitChat() {}, emitTask() {} });
ensureRallyDirs(paths);
mkdirSync(paths.workspaceDir, { recursive: true });
writeFileSync(join(paths.workspaceDir, "README.md"), "cloud fixture");
async function until(predicate) {
	const deadline = Date.now() + 20000;
	while (!predicate()) { if (Date.now() > deadline) throw Error("Timed out: " + JSON.stringify(supervisor.board())); await setTimeout(30); }
}
try {
	await supervisor.models.save([{ id: "offline-cloud", name: "Offline", protocol: "messages", baseUrl: "http://127.0.0.1:1", apiKey: "faux-key", models: faux.models.map(model => defaultModel(model.id)) }]);
	const runtime = await supervisor.models.whenReady();
	runtime.registerProvider("offline-cloud", { api: faux.api, apiKey: "faux-key", baseUrl: "http://127.0.0.1:1", models: faux.models.map(model => ({ ...model, type: "chat" })) });
	supervisor.models.setActive({ provider: "offline-cloud", model: "main", thinkingLevel: "off" });
	await supervisor.models.selectWorker({ provider: "offline-cloud", model: "worker", thinkingLevel: "off" });
	await supervisor.start();
	faux.setResponses([
		context => {
			const user = context.messages.filter(message => message.role === "user").map(textOf).join("\n");
			const id = /User message (#\d+)/.exec(user)?.[1]; assert.ok(id);
			return fauxAssistantMessage(fauxToolCall("task_dispatch", { title: "Cloud shell test", quotes: [{ id }], cwd: paths.workspaceDir, mode: "write", scope: ["cloud-result.txt"] }), { stopReason: "toolUse" });
		},
		fauxAssistantMessage("等待批准。"),
		context => {
			const names = getCurrentTools(context.messages).map(tool => tool.name);
			assert.ok(names.includes("bash"));
			if (process.platform !== "win32") assert.ok(!names.includes("powershell"));
			return fauxAssistantMessage(fauxToolCall(shell, { command }), { stopReason: "toolUse" });
		},
		fauxAssistantMessage(fauxToolCall("read", { path: "cloud-result.txt" }), { stopReason: "toolUse" }),
		context => {
			assert.ok(textOf(context.messages.findLast(message => message.role === "toolResult")).includes("cloud-worker-ok"));
			return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "云端文件已写入" }), { stopReason: "toolUse" });
		},
		fauxAssistantMessage("worker 完成"),
		fauxAssistantMessage("云端任务已完成。"),
	]);
	await supervisor.main.send("请在工作区执行 shell，写入并读取 cloud-result.txt 后汇报。");
	await until(() => supervisor.board().tasks[0]?.status === "pending_approval" && !supervisor.main.isBusy());
	const task = supervisor.store.list()[0];
	supervisor.approve(task.id);
	// The runtime continues independently without a client or browser process.
	await until(() => task.ended?.outcome === "done");
	await until(() => !supervisor.workers.has(task.id) && supervisor.main.state().messages.some(message => message.text === "云端任务已完成。"));
	assert.equal(readFileSync(join(paths.workspaceDir, "cloud-result.txt"), "utf8"), "cloud-worker-ok");
	assert.deepEqual(supervisor.store.timeline(task.id).map(call => [call.name, call.status]), [[shell, "ok"], ["read", "ok"], ["task_report", "ok"]]);
	assert.equal(faux.getPendingResponseCount(), 0);
	console.log("Headless dispatch, approval, shell, file, worker report and main relay passed");
} finally { await supervisor.dispose(); faux.unregister(); }
