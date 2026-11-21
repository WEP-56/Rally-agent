import type { ResourceStore } from "../resource-store.ts";
import type { ResourceRef } from "../../shared/resources.ts";
import type { ToolCall } from "../../shared/tools.ts";
import type { EventLog } from "./event-log.ts";
import type { TaskStore } from "./task-store.ts";

/** Old main conversations remain searchable; deleted task history does not retain private outputs. */
export function recoverResourceReferences(resources: ResourceStore, events: EventLog, tasks: TaskStore): number {
  const owners = new Map<string, Set<string>>();
  const add = (owner: string, refs: readonly ResourceRef[]) => {
    const ids = owners.get(owner) ?? new Set<string>();
    for (const ref of refs) if (typeof ref?.id === "string") ids.add(ref.id);
    owners.set(owner, ids);
  };
  for (const event of events.ofKind("chat_message")) {
    const n = Number(event.data.n);
    if (!Number.isSafeInteger(n) || n < 1) continue;
    add(`message:#${n}`, [
      ...(Array.isArray(event.data.attachments) ? event.data.attachments as ResourceRef[] : []),
      ...(Array.isArray(event.data.toolCalls) ? (event.data.toolCalls as ToolCall[]).flatMap(call => call.attachments ?? []) : []),
    ]);
  }
  for (const task of tasks.list()) add(`task:${task.id}`, [
    ...[...task.quotes, ...task.inputs.flatMap(input => input.quotes ?? [])].flatMap(quote => quote.attachments ?? []),
    ...task.inputs.flatMap(input => input.attachments ?? []),
    ...tasks.timeline(task.id).flatMap(call => call.attachments ?? []),
    ...task.runs.flatMap(run => run.lastReport?.attachments ?? []),
  ]);
  // A damaged event might contain the only surviving reference. Preserve existing references then.
  return resources.restoreReferences(owners, events.warnings.length === 0);
}
