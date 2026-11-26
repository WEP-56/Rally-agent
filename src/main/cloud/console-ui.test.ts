import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

// Exercise the deployable browser bundle, with no server, real credentials or API.
const html = readFileSync("out/server/src/main/cloud/console/index.html", "utf8");
const script = readFileSync("out/server/src/main/cloud/console/console.js", "utf8");
const windows: JSDOM[] = [];
const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error("Console did not settle");
};

function setup(dark = false) {
  const dom = new JSDOM(html, { url: "https://console.test", runScripts: "outside-only", pretendToBeVisual: true });
  windows.push(dom);
  const { window } = dom;
  const now = Date.now();
  let pairing = true;
  let devices = [
    { id: "one", name: "<img src=x onerror=alert(1)>", paired: 1, seen: now },
    { id: "two", name: "旧电脑", paired: 1, seen: now - 100000 },
    { id: "three", name: "手机", paired: 0, seen: null },
  ];
  const requests: { action: string; id?: string; enabled?: boolean; name?: string }[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-admin");
    const request = JSON.parse(String(init.body));
    requests.push(request);
    let result = {};
    if (request.action === "status") result = { instance: "test-instance", pairing, devices };
    if (request.action === "issue") {
      devices = [...devices, { id: "new", name: request.name, paired: 0, seen: null }];
      result = { key: "test-invite" };
    }
    if (request.action === "pairing") pairing = request.enabled;
    if (request.action === "revoke") devices = devices.filter(device => device.id !== request.id);
    return { ok: true, json: async () => result };
  });
  Object.defineProperty(window, "fetch", { value: fetch, configurable: true });
  Object.defineProperty(window, "matchMedia", { value: (query: string) => ({ matches: query.includes("reduce") || (dark && query.includes("dark")), addEventListener() {}, removeEventListener() {} }) });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function (value = "") { this.returnValue = value; this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.eval(script);
  const byId = (id: string) => window.document.getElementById(id)!;
  const submit = (id: string) => byId(id).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const idle = () => waitFor(() => !(byId("refresh") as HTMLButtonElement).disabled);
  const login = async () => {
    (byId("admin") as HTMLInputElement).value = "test-admin";
    submit("auth");
    await idle();
  };
  return { window, byId, submit, idle, login, requests, fetch };
}

afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });

describe("Linux deployment console", () => {
  it("renders accurate statistics and treats device names as plain text", async () => {
    const app = setup();
    await app.login();
    expect(app.byId("panel").hidden).toBe(false);
    expect(["total", "paired", "pending", "recent"].map(name => app.byId(`stat-${name}`).textContent)).toEqual(["3", "2", "1", "1"]);
    expect(app.byId("devices").querySelector("img")).toBeNull();
    expect(app.byId("devices").textContent).toContain("<img src=x onerror=alert(1)>");
    expect(app.byId("updated").textContent).toContain("45 秒");
    expect(app.window.document.documentElement.style.getPropertyValue("--md-sys-color-primary")).toMatch(/^#/);
  });

  it("issues a key, changes pairing and clears secrets on logout", async () => {
    const app = setup();
    await app.login();
    (app.byId("name") as HTMLInputElement).value = "新手机";
    app.submit("issue");
    await app.idle();
    expect(app.byId("issued").textContent).toBe("test-invite");
    expect(app.byId("stat-pending").textContent).toBe("2");
    app.byId("pairing").click();
    await app.idle();
    expect(app.byId("pairing").getAttribute("aria-checked")).toBe("false");
    expect(app.requests).toContainEqual({ action: "pairing", enabled: false });
    app.byId("logout").click();
    expect(app.byId("issued").textContent).toBe("");
    expect(app.byId("login").hidden).toBe(false);
    expect(app.window.localStorage.length).toBe(0);
  });

  it("requires the dialog confirmation before revoking", async () => {
    const app = setup();
    await app.login();
    (app.byId("devices").querySelector("button") as HTMLButtonElement).click();
    const dialog = app.byId("revoke-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    dialog.close("cancel");
    await app.idle();
    expect(app.requests.some(request => request.action === "revoke")).toBe(false);
    (app.byId("devices").querySelector("button") as HTMLButtonElement).click();
    dialog.close("confirm");
    await app.idle();
    expect(app.requests).toContainEqual({ action: "revoke", id: "one" });
    expect(app.byId("stat-total").textContent).toBe("2");
  });

  it("uses the shared dark color scheme", async () => {
    const light = setup();
    const dark = setup(true);
    expect(dark.window.document.documentElement.classList.contains("dark")).toBe(true);
    expect(dark.window.document.documentElement.style.getPropertyValue("--md-sys-color-surface"))
      .not.toBe(light.window.document.documentElement.style.getPropertyValue("--md-sys-color-surface"));
  });

  it("selects the invite for manual copying when clipboard access is unavailable", async () => {
    const app = setup();
    await app.login();
    (app.byId("name") as HTMLInputElement).value = "手机";
    app.submit("issue");
    await app.idle();
    app.byId("copy-key").click();
    await waitFor(() => app.byId("status").textContent?.includes("手动复制") ?? false);
    expect(app.window.getSelection()?.toString()).toBe("test-invite");
  });

  it("returns to login after an expired admin credential", async () => {
    const app = setup();
    await app.login();
    app.fetch.mockImplementationOnce(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    app.byId("refresh").click();
    await app.idle();
    expect(app.byId("login").hidden).toBe(false);
    expect(app.byId("status").textContent).toContain("重新登录");
  });
});
