import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantContent } from "./AssistantContent";
import { ChatPanel } from "./ChatPanel";
import { GateCard } from "./GateCard";
import { QuestionCard } from "./QuestionCard";
import type { TaskGate } from "../../../shared/gate";

vi.mock("../store", () => ({ useApp: () => ({ config: { name: "Rally" }, openTab: () => {}, openTask: () => {} }) }));

describe("Rally conversation rendering (no browser)", () => {
	it("renders text, collapsed thinking and tools in provider order", () => {
		const html = renderToStaticMarkup(createElement(AssistantContent, { blocks: [
			{ type: "text", text: "BEFORE_THINKING" }, { type: "thinking", text: "EXPOSED_THINKING" },
			{ type: "tool", toolCallId: "call-1" }, { type: "text", text: "AFTER_TOOL" },
		], calls: [{ id: "call-1", name: "read", input: "README.md", startedAt: 1, endedAt: 2, status: "ok", output: "COLLAPSED_TOOL_OUTPUT" }] }));
		expect(html.indexOf("BEFORE_THINKING")).toBeLessThan(html.indexOf("EXPOSED_THINKING"));
		expect(html.indexOf("EXPOSED_THINKING")).toBeLessThan(html.indexOf("已完成 1 次工具调用"));
		expect(html.indexOf("已完成 1 次工具调用")).toBeLessThan(html.indexOf("AFTER_TOOL"));
		expect(html).toContain("<details");
		expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
		expect(html).not.toContain("COLLAPSED_TOOL_OUTPUT");
	});

	it("keeps thinking-only main messages visible and retains intermediate assistant text", () => {
		const html = renderToStaticMarkup(createElement(ChatPanel, {
			messages: [
				{ id: "1", role: "assistant", text: "", blocks: [{ type: "thinking", text: "THINKING_ONLY_MESSAGE" }] },
				{ id: "2", role: "assistant", text: "INTERMEDIATE_MESSAGE", blocks: [{ type: "text", text: "INTERMEDIATE_MESSAGE" }] },
				{ id: "3", role: "assistant", text: "" },
			], tasks: [], busy: false, onSend: () => {}, onStop: () => {}, onNewChat: () => {}, rightOpen: true,
			onToggleRight: () => {}, models: [], model: null, thinkingLevel: null, onSelectModel: () => {}, autoApprove: false, onAutoApprove: async () => {},
		}));
		expect(html).toContain("THINKING_ONLY_MESSAGE");
		expect(html).toContain("INTERMEDIATE_MESSAGE");
		expect(html.match(/class="animate-rise text-sm leading-relaxed"/g)).toHaveLength(2);
		expect(html).not.toContain("正在规划");
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
		expect(html.match(/<button/g)).toHaveLength(2); expect(html).not.toContain("<input");
		expect(html).toContain("或直接在下方输入你的回答");
		const answered = renderToStaticMarkup(createElement(QuestionCard, { ...props, question: { ...question, answer: { by: "user", basis: [], text: "保留 <v1>", at: 3 } } }));
		expect(answered).toContain("你已回答"); expect(answered).not.toContain("<button");
		const closed = renderToStaticMarkup(createElement(QuestionCard, { ...props, question: { ...question, closed: { reason: "replaced", at: 3 } } }));
		expect(closed).toContain("问题已替换"); expect(closed).not.toContain("<button");
	});
});
