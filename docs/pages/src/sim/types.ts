/* 模拟工位的数据形状。字段命名尽量贴近 Rally 客户端（ChatPanel / Workstation / GateCard）。 */

export type TaskStatus = "running" | "done" | "scheduled" | "needs_gate" | "needs_answer" | "interrupted";
export type ToolState = "running" | "ok" | "interrupted";
/** 连接器工具的三档权限：可逆直接执行 / 有对外代价执行并留审计 / 不可逆先问你 */
export type Tier = "reversible" | "external" | "irreversible";
export type Activity = "idle" | "thinking" | "querying" | "orchestrating" | "tooling" | "replying";

export interface ToolEntry {
  kind: "tool";
  id: string;
  name: string;
  target: string;
  output: string;
  status: ToolState;
  duration?: string;
  note?: string;
}

export interface TextEntry {
  kind: "text";
  id: string;
  text: string;
  final?: boolean;
}

/** 任务转录与主对话共用的条目 */
export type Entry = ToolEntry | TextEntry;

export interface SimTask {
  id: string;
  title: string;
  summary: string;
  status: TaskStatus;
  createdAt: number;
  duration: string;
  cwd: string;
  items: Entry[];
}

export interface GateReq {
  id: string;
  taskId: string;
  tool: string;
  action: string;
  cwd: string;
  scope: string[];
  alternative: string;
  mailBody?: string;
  expiresAt: number;
  decision?: "allow" | "deny";
}

export interface QuestionReq {
  id: string;
  question: string;
  options: string[];
  answer?: string;
  /** 因停止而关闭，未被回答 */
  closed?: boolean;
}

export type ChatItem =
  | Entry
  | { kind: "user"; id: string; text: string }
  | { kind: "typing"; id: string }
  | { kind: "task"; id: string; taskId: string }
  | { kind: "gate"; id: string; gate: GateReq }
  | { kind: "question"; id: string; question: QuestionReq }
  | { kind: "system"; id: string; text: string };

export interface Tab {
  id: string;
  kind: "workstation" | "task" | "connections";
  taskId?: string;
}
