import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantContent } from "./AssistantContent";
import { ChatPanel } from "./ChatPanel";
import { GateCard } from "./GateCard";
import { QuestionCard } from "./QuestionCard";
import type { TaskGate } from "../../../shared/gate";
import { conversationItems } from "../conversation";
import { messagesOf } from "../task-messages";
import type { TaskView } from "../../../shared/task";

vi.mock("../store", () => ({ useApp: () => ({ config: { name: "Rally" }, openTab: () => {}, openTask: () => {} }) }));

describe("Rally conversation rendering (no browser)", () => {
	it("renders text, collapsed thinking and tools in provider order", () => {
		const html = renderToStaticMarkup(createElement(AssistantContent, { blocks: [
			{ type: "text", text: "BEFORE_THINKING" }, { type: "thinking", text: "EXPOSED_THINKING" },
			{ type: "tool", toolCallId: "call-1" }, { type: "text", text: "AFTER_TOOL" },
		], calls: [{ id: "call-1", name: "read", input: "README.md", startedAt: 1, endedAt: 2, status: "ok", output: "COLLAPSED_TOOL_OUTPUT" }] }));
		expect(html.indexOf("BEFORE_THINKING")).toBeLessThan(html.indexOf("EXPOSED_THINKING"));
		expect(html.indexOf("EXPOSED_THINKING")).toBeLessThan(html.indexOf("已读取 1 个文件"));
		expect(html.indexOf("已读取 1 个文件")).toBeLessThan(html.indexOf("AFTER_TOOL"));
		expect(html).toContain("<details");
		expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
		expect(html).not.toContain("COLLAPSED_TOOL_OUTPUT");
	});

	it("hides router thinking and tool records while retaining intermediate assistant text", () => {
		const html = renderToStaticMarkup(createElement(ChatPanel, {
			messages: [
				{ id: "1", role: "assistant", text: "", blocks: [{ type: "thinking", text: "THINKING_ONLY_MESSAGE" }] },
				{ id: "2", role: "assistant", text: "INTERMEDIATE_MESSAGE", blocks: [{ type: "text", text: "INTERMEDIATE_MESSAGE" }] },
				{ id: "3", role: "assistant", text: "", blocks: [{ type: "tool", toolCallId: "hidden" }], toolCalls: [{ id: "hidden", name: "read", input: "hidden.txt", startedAt: 1, status: "running" }] },
			], tasks: [], header: { activity: null, showCompact: false, showNewConversation: false }, busy: false, onSend: () => {}, onStop: () => {}, onNewChat: () => {}, onCompactChat: () => {}, rightOpen: true,
			onToggleRight: () => {}, autoApprove: false, onAutoApprove: async () => {},
		}));
		expect(html).not.toContain("THINKING_ONLY_MESSAGE");
		expect(html).toContain("INTERMEDIATE_MESSAGE");
		expect(html).not.toContain("已读取");
		expect(html).not.toContain("思考过程");
		expect(html).not.toContain("正在规划");
		expect(html).toContain("待命");
		expect(html).not.toContain("整理上下文 (Ctrl+Shift+N)");
		expect(html).not.toContain("新建会话 (Ctrl+N)");
	});

	it("keeps approval requests and their decisions between the same chat messages", () => {
		const now = Date.now();
		const gate: TaskGate = { id: "G-7", runId: "R-1", toolCallId: "call", tool: "qqmail_send", cwd: "/work", action: "发送邮件", scope: ["测试收件人"],
			alternative: "保留草稿", arguments: { text: "草稿正文" }, requestedAt: now - 3, escalatedAt: now - 2, expiresAt: now + 60000 };
		const render = (decisions: TaskGate[]) => renderToStaticMarkup(createElement(ChatPanel, {
			messages: [{ id: "m-1", role: "assistant", text: "BEFORE_GATE", at: now - 4, taskRef: "T-1064" },
				{ id: "m-2", role: "assistant", text: "AFTER_GATE", at: now - 1 }],
			tasks: [{ id: "T-1064", title: "邮件任务", summary: "fixture", createdAt: now - 5, duration: "1 秒", progress: 0, status: "needs_gate", tags: [], messages: [], gates: decisions }],
			header: { activity: "querying", showCompact: true, showNewConversation: false },
			busy: false, onSend: () => {}, onStop: () => {}, onNewChat: () => {}, onCompactChat: () => {}, rightOpen: true, onToggleRight: () => {},
			autoApprove: false, onAutoApprove: async () => {},
		}));
		const pending = render([gate]);
		const denied = render([{ ...gate, decision: { value: "deny", actor: "user", at: now, reason: "测试拒绝", basis: [] } }]);
		for (const html of [pending, denied]) {
			const card = 'id="gate-G-7"';
			expect(html.split(card)).toHaveLength(2);
			expect(html.indexOf("BEFORE_GATE")).toBeLessThan(html.indexOf(card));
			expect(html.indexOf(card)).toBeLessThan(html.indexOf("AFTER_GATE"));
		}
		expect(pending).toContain("确认发送</button>");
		expect(pending).toContain("查询中");
		expect(pending).toContain("motion-safe:animate-spin");
		expect(pending).toContain("整理上下文 (Ctrl+Shift+N)");
		expect(pending).not.toContain("新建会话 (Ctrl+N)");
		expect(denied).toContain("已拒绝");
		expect(denied).not.toContain("确认发送</button>");
	});

	it("groups adjacent calls across provider turns and keeps question history before later replies", () => {
		const items = conversationItems([
			{ id: "1", at: 1, role: "assistant", text: "", blocks: [{ type: "tool", toolCallId: "a" }], toolCalls: [{ id: "a", name: "read", input: "one.md", status: "ok", startedAt: 1 }] },
			{ id: "2", at: 2, role: "assistant", text: "", blocks: [{ type: "text", text: " " }, { type: "tool", toolCallId: "b" }], toolCalls: [{ id: "b", name: "read", input: "two.md", status: "ok", startedAt: 2 }] },
			{ id: "3", at: 4, role: "assistant", text: "LATER_REPLY" },
		], [{ taskId: "T-1", title: "Task", question: { id: "Q-1", runId: "R-1", askedAt: 1, question: "CONFIRM", answer: { by: "user", text: "ANSWER", basis: [], at: 3 } } }]);
		expect(items.map(item => item.role)).toEqual(["assistant", "question", "assistant"]);
		const first = items[0]; if (first.role !== "assistant") throw new Error("Missing assistant group");
		const html = renderToStaticMarkup(createElement(AssistantContent, { blocks: first.blocks!, calls: first.toolCalls }));
		expect(html).toContain("已读取 2 个文件"); expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain("one.md");
	});

	it("shows frozen resume/steer inputs between worker replies with delivery state", () => {
		const view: TaskView = { id: "T-1", title: "task", status: "done", statusText: "done", mode: "readonly", cwd: "/work", scope: [], quotes: [], dependsOn: [], createdAt: 1, updatedAt: 8, durationMs: 0,
			approval: { state: "approved" }, usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
			assistantMessages: [{ id: "a", runId: "R-1", at: 2, text: "BEFORE", blocks: [{ type: "text", text: "BEFORE" }], streaming: false }, { id: "b", runId: "R-2", at: 6, text: "AFTER", blocks: [{ type: "text", text: "AFTER" }], streaming: false }],
			inputs: [{ id: "I-1", kind: "resume", at: 4, deliveredAt: 5, note: "SECOND_BRIEF", quotes: [{ messageId: "#2", kind: "user", text: "EXACT_USER_WORDS", at: 3 }] }, { id: "I-2", kind: "steer", at: 7, note: "QUEUED_BRIEF" }] };
		const messages = messagesOf(view);
		expect(messages.map(message => message.role)).toEqual(["assistant", "rally", "assistant", "rally"]);
		expect(messages[1]).toMatchObject({ label: "续接任务 · 已投递", text: "EXACT_USER_WORDS\n\n主 agent 备注：SECOND_BRIEF" });
		expect(messages[3]).toMatchObject({ label: "追加指令 · 待投递", text: "主 agent 备注：QUEUED_BRIEF" });
	});

	it("renders gate request fields verbatim as text and collapses decided cards", () => {
		const gate: TaskGate = { id: "G-1", runId: "R-1", toolCallId: "call", tool: "mcp__fixture__echo", cwd: "C:\\fixture",
			action: "删除 <script>alert(1)</script>", scope: ["dist/", "coverage/"], alternative: "仅保留原文件", arguments: { target: "dist/" }, requestedAt: Date.now(), expiresAt: Date.now() + 600000, escalatedAt: Date.now() };
		const props = { taskId: "T-1", gate, decide: async () => {} };
		const html = renderToStaticMarkup(createElement(GateCard, props));
		expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
		expect(html).toContain("dist/\ncoverage/"); expect(html).toContain("仅保留原文件");
		expect(html).toContain("原始参数"); expect(html).toContain(">允许</button>"); expect(html).toContain(">拒绝</button>");
		const decided = renderToStaticMarkup(createElement(GateCard, { ...props, gate: { ...gate, decision: { value: "allow", actor: "main", basis: ["#12"], reason: "用户已指定范围", at: Date.now() } } }));
		expect(decided).toContain("已允许"); expect(decided).toContain("#12"); expect(decided).not.toContain("<button");
	});

	it("shows deletion-specific risks without requiring raw-parameter expansion", () => {
		const gate: TaskGate = { id: "G-2", runId: "R-1", toolCallId: "delete", tool: "file_delete", cwd: "C:\\fixture", action: "删除 2 项", scope: ["C:\\fixture\\a", "C:\\outside\\b"], alternative: "保留文件",
			arguments: { uncommitted: ["C:\\fixture\\<script>"], outsideCwd: ["C:\\outside\\b", 12] }, requestedAt: Date.now(), expiresAt: Date.now() + 120000 };
		const html = renderToStaticMarkup(createElement(GateCard, { taskId: "T-1", gate, decide: async () => {} }));
		expect(html.indexOf("未提交改动：")).toBeLessThan(html.indexOf("<details"));
		expect(html.indexOf("cwd 外目标：")).toBeLessThan(html.indexOf("<details"));
		expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
	});

	it("renders exact question/options safely and disables completed or obsolete cards", () => {
		const question = { id: "Q-1", question: "  保留 <script>？\n下一行。 ", options: ["保留 <v1>", "移除"], runId: "R-1", askedAt: 1, escalatedAt: 2 };
		const props = { taskId: "T-1", title: "接口迁移", question, answer: async () => {} };
		const html = renderToStaticMarkup(createElement(QuestionCard, props));
		expect(html).toContain("  保留 &lt;script&gt;？\n下一行。 ");
		expect(html).not.toContain("<script>"); expect(html).toContain("保留 &lt;v1&gt;");
		expect(html.match(/<button/g)).toHaveLength(3);
		expect(html).toContain('<textarea'); expect(html).toContain('aria-label="你的回答"');
		expect(html).toContain("提交回答");
		const answered = renderToStaticMarkup(createElement(QuestionCard, { ...props, question: { ...question, answer: { by: "user", basis: [], text: "保留 <v1>", at: 3 } } }));
		expect(answered).toContain("你已回答"); expect(answered).not.toContain("<button");
		const closed = renderToStaticMarkup(createElement(QuestionCard, { ...props, question: { ...question, closed: { reason: "replaced", at: 3 } } }));
		expect(closed).toContain("问题已替换"); expect(closed).not.toContain("<button");
	});
});
