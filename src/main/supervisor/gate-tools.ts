import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { GateService } from "./gates.ts";
import type { TaskStore } from "./task-store.ts";

export function createGateTools(gates: GateService, store: TaskStore): ToolDefinition[] {
	const decideSchema = Type.Object({ gateId: Type.String(), decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
		quotes: Type.Optional(Type.Array(Type.Object({ id: Type.String(), withProposal: Type.Optional(Type.Boolean()) }), { minItems: 1 })), reason: Type.String({ minLength: 1 }) });
	const escalateSchema = Type.Object({ kind: Type.Union([Type.Literal("gate"), Type.Literal("question")]), taskId: Type.String(), id: Type.String() });
	return [{
		name: "gate_decide", label: "决定内门", description: "Allow an irreversible action only when quoted user messages cover that exact action and scope. Otherwise escalate. Deny needs no quotes. A decision applies once to the frozen arguments.",
		parameters: decideSchema,
		execute: async (_id, params: Static<typeof decideSchema>) => {
			try { gates.decide(params.gateId, params.decision, "main", params.quotes, params.reason); return result({ decided: true }); }
			catch (error) { return failure(error); }
		},
	}, {
		name: "escalate", label: "请求用户处理", description: "Show a gate confirmation or question card to the user, copying the worker request verbatim. No quotes required.",
		parameters: escalateSchema,
		execute: async (_id, params: Static<typeof escalateSchema>) => {
			try {
				if (params.kind === "question") store.escalateAttention(params.taskId, params.id);
				else gates.escalate(params.taskId, params.id);
				return result({ shown: true });
			}
			catch (error) { return failure(error); }
		},
	}];
}

function result(data: Record<string, unknown>) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data }; }
function failure(error: unknown) {
	const code = error instanceof Error && "code" in error ? `${String(error.code)}: ` : "";
	return { ...result({ error: `${code}${error instanceof Error ? error.message : String(error)}` }), isError: true };
}
