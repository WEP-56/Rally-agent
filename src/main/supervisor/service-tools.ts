import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { ServiceManager } from "./services.ts";

const startSchema = Type.Object({ name: Type.String({ minLength: 1 }), command: Type.String({ minLength: 1 }), cwd: Type.Optional(Type.String()), port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })), readyPattern: Type.Optional(Type.String({ maxLength: 256 })), env: Type.Optional(Type.Record(Type.String(), Type.String())) });
const stopSchema = Type.Object({ serviceId: Type.String() });
const statusSchema = Type.Object({ serviceId: Type.String(), tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })) });
const result = (details: object) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });

export function createServiceTools(services: ServiceManager, task: Task, run: TaskRun): ToolDefinition[] {
	return [{
		name: "service_start", label: "启动服务", parameters: startSchema,
		description: "Start a long-lived service using PowerShell on Windows or Bash elsewhere. cwd defaults to the task cwd. Wait up to 30 seconds for a listening local port or readyPattern; ready=false may still be running. Services survive task completion, do not occupy worker slots and never wake workers. Use jobs for finite commands. Environment values are not saved in service records.",
		async execute(_id: string, params: Static<typeof startSchema>, signal?: AbortSignal) { const value = await services.start(task, run, params, signal); return { ...result(value), ...(value.status !== "running" ? { isError: true } : {}) }; },
	}, {
		name: "service_stop", label: "停止服务", parameters: stopSchema,
		description: "Stop a service owned by this task, including one from a previous run. Wait for process tree termination; other tasks' services are inaccessible.",
		async execute(_id: string, params: Static<typeof stopSchema>) { return result(await services.stop(params.serviceId, "worker", task.id)); },
	}, {
		name: "service_status", label: "服务状态", parameters: statusSchema,
		description: "Immediately read this task's service state and bounded output tail (default 200 lines, max 2000). Does not wait or wake a worker.",
		async execute(_id: string, params: Static<typeof statusSchema>) { return result(services.status(task.id, params.serviceId, params.tail)); },
	}];
}
