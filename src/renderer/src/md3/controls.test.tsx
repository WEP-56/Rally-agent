// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChoiceSelect, optionsFromChildren } from "./Select";
import { Checkbox, Disclosure } from "./interactive";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function press(element: Element, key: string) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
}

describe("MD3 controls", () => {
  it("retains grouped values, empty values and disabled options without rendering a native menu", async () => {
    const changed = vi.fn();
    const options = optionsFromChildren(<><option value="">默认</option><optgroup label="供应商"><option value="a">模型 A</option><option value="b" disabled>模型 B</option></optgroup></>);
    expect(options.map(option => option.value)).toEqual(["", "a", "b"]);
    expect(options[1].group).toBe("供应商");
    await act(async () => root.render(<ChoiceSelect aria-label="模型" value="" options={options} onValueChange={changed} />));
    const trigger = host.querySelector('[role="combobox"]')!;
    await press(trigger, "Enter");
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.querySelector("select")).toBeNull();
    await press(trigger, "ArrowDown");
    await press(trigger, "Enter");
    expect(changed).toHaveBeenCalledWith("a");
  });

  it("honors a disabled fieldset and preserves required form validation", async () => {
    await act(async () => root.render(<form><fieldset disabled><ChoiceSelect aria-label="禁用模型" value="" required onValueChange={() => {}}><option value="a">A</option></ChoiceSelect></fieldset></form>));
    const trigger = host.querySelector('button')!;
    await press(trigger, "Enter");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.render(<form><ChoiceSelect aria-label="必填模型" value="" required onValueChange={() => {}}><option value="a">A</option></ChoiceSelect></form>));
    await act(async () => { expect(host.querySelector("form")!.checkValidity()).toBe(false); });
    expect(host.querySelector('[role="combobox"]')!.getAttribute("aria-expanded")).toBe("true");
  });

  it("anchors a short upward menu by its bottom edge and follows scrolling", async () => {
    vi.stubGlobal("innerHeight", 768);
    vi.stubGlobal("innerWidth", 1024);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(132);
    await act(async () => root.render(<ChoiceSelect value="a" onValueChange={() => {}}><option value="a">每天 1 次</option><option value="b">每天 2 次</option></ChoiceSelect>));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    let top = 700;
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => new DOMRect(40, top, 300, 40));
    await press(trigger, "Enter");
    const menu = document.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(menu.style.top).toBe("");
    expect(menu.style.bottom).toBe("74px"); // 768 - 700 + 6px anchor gap.
    expect(menu.style.transformOrigin).toBe("bottom center");
    top = 650;
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(menu.style.bottom).toBe("124px");
    top = 30;
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(menu.style.bottom).toBe("");
    expect(menu.style.top).toBe("76px");
    expect(menu.style.transformOrigin).toBe("top center");
  });

  it("uses the short menu's content height when choosing a direction", async () => {
    vi.stubGlobal("innerHeight", 768);
    vi.stubGlobal("innerWidth", 1024);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(132);
    await act(async () => root.render(<ChoiceSelect value="a" onValueChange={() => {}}><option value="a">选项</option></ChoiceSelect>));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(900, 500, 100, 40));
    await press(trigger, "Enter");
    const menu = document.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(menu.style.top).toBe("546px");
    expect(menu.style.bottom).toBe("");
    expect(menu.style.left).toBe("772px");
    expect(menu.style.maxHeight).toBe("210px");
  });

  it("keeps native checkbox keyboard/form semantics beneath the custom surface", async () => {
    const changed = vi.fn();
    await act(async () => root.render(<label><Checkbox checked={false} onChange={changed} />推荐技能</label>));
    await act(async () => host.querySelector('input')!.click());
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("opens a disclosure with a real summary and retains its content for animated closing", async () => {
    await act(async () => root.render(<Disclosure><summary>工具详情</summary><p>实际输出</p></Disclosure>));
    expect(host.querySelector("details")!.open).toBe(false);
    await act(async () => host.querySelector("summary")!.click());
    expect(host.querySelector("details")!.open).toBe(true);
    expect(host.querySelector("summary")!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => host.querySelector("summary")!.click());
    expect(host.querySelector("summary")!.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).toContain("实际输出");
  });
});
