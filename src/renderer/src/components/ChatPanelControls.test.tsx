// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

vi.mock("../store", () => ({ useApp: () => ({ config: { name: "Rally" }, openTab: vi.fn(), openTask: vi.fn(), openSettings: vi.fn() }) }));
vi.mock("../credentials", () => ({ useCredentials: () => ({ state: { requests: [] }, setState: vi.fn() }) }));
vi.mock("../agent-browser", () => ({ useAgentBrowsers: () => [] }));
vi.mock("./PresenceCapsule", () => ({ PresenceCapsule: () => null }));

let host: HTMLDivElement;
let root: Root;
const inbox = vi.fn(async () => {});
const props: ComponentProps<typeof ChatPanel> = {
  messages: [{ id: "m1", role: "user", text: "请求", delivery: { status: "queued" } }], tasks: [],
  header: { activity: null, showCompact: false, showNewConversation: false },
  busy: false, inboxPaused: true, onSend: vi.fn(), onStop: vi.fn(), onNewChat: vi.fn(), onCompactChat: vi.fn(),
  rightOpen: true, onToggleRight: vi.fn(),
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("rally", { chat: { inbox } });
  vi.stubGlobal("runtime", { mode: "local", platform: "desktop" });
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  inbox.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("composer and delivery icon actions", () => {
  it("resumes a paused queue through the composer icon without a text status strip", async () => {
    await act(async () => root.render(<ChatPanel {...props} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="继续队列（1 条待处理）"]')!;
    expect(button.disabled).toBe(false);
    expect(button.querySelector("svg.lucide-pause")).not.toBeNull();
    expect(host.textContent).not.toContain("消息队列已暂停");
    expect(host.textContent).not.toContain("继续队列");
    await act(async () => button.click());
    expect(inbox).toHaveBeenCalledWith({ action: "resume" });
  });

  it("keeps a single stop action when the agent is busy", async () => {
    await act(async () => root.render(<ChatPanel {...props} busy />));
    expect(host.querySelector('button[aria-label="停止回复并暂停队列"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label^="继续队列"]')).toBeNull();
  });

  it("renders failed delivery as two icons and preserves cancel/retry requests", async () => {
    await act(async () => root.render(<ChatPanel {...props} messages={[{ id: "m2", role: "user", text: "请求", delivery: { status: "failed", error: "已停止处理；如需继续，请重试这条消息。" } }]} />));
    expect(host.textContent).not.toContain("处理未完成");
    expect(host.textContent).not.toContain("已停止处理");
    const cancel = host.querySelector<HTMLButtonElement>('button[aria-label="撤回"]')!;
    const retry = host.querySelector<HTMLButtonElement>('button[aria-label="重试"]')!;
    expect(cancel.textContent).toBe(""); expect(retry.textContent).toBe("");
    await act(async () => cancel.click());
    await act(async () => retry.click());
    expect(inbox.mock.calls).toEqual([[{ action: "cancel", id: "m2" }], [{ action: "retry", id: "m2" }]]);
  });
});
