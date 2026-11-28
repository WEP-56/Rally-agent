import { Type } from "typebox";
import { TaskError } from "./task-store.ts";

export const TaskNoteSchema = Type.String({ maxLength: 2000, description: "Use up to 2000 characters in the user's language to clarify references in the quoted request, such as the agent, project/path or prior decision. Background is copied separately through context/memory; do not paste it here. No guesses, new requirements, plans, steps or acceptance criteria." });

export function checkTaskNote(note?: string): void {
	if (note === undefined) return;
	if (typeof note !== "string") throw new TaskError("NOTE_INVALID", "备注必须是文本");
	const length = [...note].length;
	if (length > 2000) throw new TaskError("NOTE_TOO_LONG", `备注共 ${length} 字符，上限为 2000 字符；请缩短备注，完整背景可通过 context/memory 携带。备注不会自动截断。`);
}
