import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudMirror } from "../../src/shared/cloud-state.ts";
import { IpcChannel as C, IpcEvent as E } from "../../src/shared/ipc.ts";

const chat = { messages: [], header: { activity: null, showCompact: false, showNewConversation: false }, conversation: { id: "first", at: 1 }, busy: false, model: null, thinkingLevel: null, thinkingLevels: [], notice: null };
const board = { tasks: [], active: 0, limit: 2, autoApprove: false };
const snapshot = {
  epoch: "runtime-1", seq: 10,
  events: [
    { channel: E.chat, data: { type: "snapshot", state: chat } },
    { channel: E.task, data: { type: "snapshot", board } },
    { channel: E.identity, data: { name: "Cached agent", personality: "Calm", workstyle: "Plan", avatar: null } },
    { channel: E.workspace, data: { defaultWorkspace: "/workspace" } },
    { channel: E.services, data: { services: [] } },
  ],
};
const create = () => { const mirror = new CloudMirror("http://server:4711", "instance-a"); mirror.apply(snapshot); return mirror; };

test("cache resumes the exact cursor with applied messages; never crosses server or instance boundaries", () => {
  const mirror = create();
  const line = { id: "#1", role: "assistant", text: "first", streaming: true, at: 1 };
  mirror.apply({ epoch: snapshot.epoch, seq: 11, events: [{ channel: E.chat, data: { type: "message", message: line } }] });
  mirror.apply({ epoch: snapshot.epoch, seq: 12, events: [{ channel: E.chat, data: { type: "message", message: { ...line, text: "completed", streaming: false } } }] });
  const restored = new CloudMirror("http://server:4711", "instance-a");
  assert.equal(restored.restore(mirror.encode()), true);
  assert.equal(restored.seq, 12);
  assert.equal(restored.epoch, snapshot.epoch);
  assert.equal(restored.read(C.chatState).messages.length, 1);
  assert.equal(restored.read(C.chatState).messages[0].text, "completed");
  assert.equal(new CloudMirror("http://other:4711", "instance-a").restore(mirror.encode()), false);
  assert.equal(new CloudMirror("http://server:4711", "instance-b").restore(mirror.encode()), false);
});

test("conversation reset, removed tasks and changed identity replace stale cached values", () => {
  const mirror = create();
  mirror.remember(C.tasksState, { ...board, tasks: [{ id: "T-1" }] });
  mirror.apply({ epoch: "runtime-2", seq: 1, events: [
    { channel: E.chat, data: { type: "snapshot", state: { ...chat, conversation: { id: "new", at: 2 } } } },
    { channel: E.task, data: { type: "deleted", taskId: "T-1", board } },
    { channel: E.identity, data: { name: "New name", personality: "Calm", workstyle: "Plan", avatar: null } },
  ] });
  assert.equal(mirror.read(C.chatState).conversation.id, "new");
  assert.deepEqual(mirror.read(C.tasksState).tasks, []);
  assert.equal(mirror.read(C.identityInitialize).name, "New name");
  assert.equal(mirror.epoch, "runtime-2");
});

test("oversized and incomplete caches cannot claim an incremental cursor", () => {
  const mirror = create();
  mirror.remember(C.chatState, { ...chat, messages: [{ id: "#1", text: "x".repeat(5 * 1024 * 1024) }] });
  const encoded = mirror.encode();
  assert.ok(encoded.length < 4 * 1024 * 1024);
  const restored = new CloudMirror("http://server:4711", "instance-a");
  assert.equal(restored.restore(encoded), true);
  assert.equal(restored.epoch, "");
  assert.equal(restored.complete, false);
  assert.equal(restored.read(C.identityState).name, "Cached agent");
  const corrupt = new CloudMirror("http://server:4711", "instance-a");
  assert.equal(corrupt.restore("{bad json"), false);
  corrupt.apply({ epoch: "runtime", seq: 10, events: [] });
  assert.equal(corrupt.epoch, "");
});

test("cache excludes credential inputs and raw provider keys", () => {
  const mirror = create();
  mirror.remember(C.modelsSave, [{ apiKey: "secret" }]);
  mirror.remember(C.modelsState, { providers: [{ apiKey: "secret" }] });
  mirror.remember(C.mcpState, { json: '{"env":{"KEY":"secret"}}' });
  assert.ok(!mirror.encode().includes("secret"));
  mirror.remember(C.modelsState, { providers: [{ apiKey: "已保存:reference" }] });
  assert.ok(mirror.encode().includes("已保存:reference"));
});
