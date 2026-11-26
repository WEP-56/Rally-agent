import { describe, expect, it } from "vitest";
import type { ChatHeaderState } from "../../../shared/ipc";
import { resolveMascotState } from "./state";

const header = (activity: ChatHeaderState["activity"]): ChatHeaderState => ({
  activity,
  showCompact: false,
  showNewConversation: false,
});

describe("main-agent mascot state", () => {
  it("maps the main agent's query, dispatch and reply activities to distinct poses", () => {
    expect(resolveMascotState(header("querying"), 10)).toBe("searching");
    expect(resolveMascotState(header("planning"), 10)).toBe("orchestrating");
    expect(resolveMascotState(header("replying"), 10)).toBe("replying");
  });

  it("shows completion briefly, then returns to idle", () => {
    const done = { ...header(null), loopResult: { outcome: "completed" as const, at: 100 } };
    expect(resolveMascotState(done, 101)).toBe("completed");
    expect(resolveMascotState(done, 3101)).toBe("idle");
  });

  it("returns to idle after an abort instead of treating it as success", () => {
    const aborted = { ...header(null), loopResult: { outcome: "aborted" as const, at: 100 } };
    expect(resolveMascotState(aborted, 101)).toBe("idle");
  });
});
