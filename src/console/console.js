import { animate } from "motion";
import { applyMd3TokensToRoot, DEFAULT_SEED_HEX } from "../renderer/src/md3/theme.ts";
import { SPRING_FAST, SPRING_JELLY } from "../renderer/src/md3/springs.ts";

const $ = id => document.getElementById(id);
const theme = matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let key = "";
let allows = false;
let busy = false;
let session = 0;
let statusTimer;

function applyTheme() {
  applyMd3TokensToRoot(DEFAULT_SEED_HEX, theme.matches);
}
applyTheme();
theme.addEventListener("change", applyTheme);

function move(element, values, spring = SPRING_JELLY) {
  return animate(element, values, reducedMotion.matches ? { duration: 0 } : spring);
}

// Event delegation also covers freshly rendered device actions.
for (const eventName of ["pointerover", "pointerout", "pointerdown", "pointerup", "pointercancel"]) {
  document.addEventListener(eventName, event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || reducedMotion.matches) return;
    if (eventName === "pointerout" && button.contains(event.relatedTarget)) return;
    const pressed = eventName === "pointerdown";
    const hovered = eventName === "pointerover" || eventName === "pointerup";
    move(button, { scale: pressed ? 0.93 : hovered ? 1.035 : 1, borderRadius: pressed ? "12px" : "22px" });
  });
}

function notify(message, error = false, persistent = false) {
  clearTimeout(statusTimer);
  $("status").textContent = message;
  $("status").dataset.error = String(error);
  $("status").hidden = !message;
  if (message) move($("status"), { opacity: [0, 1], y: [8, 0] }, SPRING_FAST);
  if (!persistent) statusTimer = setTimeout(() => { $("status").hidden = true; }, 5000);
}

function clearIssued() {
  $("issued").textContent = "";
  $("issued-panel").hidden = true;
}

function exit() {
  session++;
  key = "";
  clearIssued();
  $("admin").value = "";
  $("name").value = "";
  $("devices").replaceChildren();
  $("instance").textContent = "";
  $("panel").hidden = true;
  $("logout").hidden = true;
  $("login").hidden = false;
  $("revoke-dialog").close("cancel");
  notify("");
  $("admin").focus();
}

async function call(action, params = {}) {
  const current = session;
  const response = await fetch("/v1/admin", {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  if (current !== session) throw Error("登录状态已变化，请重新操作。");
  if (!response.ok) {
    if (response.status === 401) exit();
    throw Error(response.status === 401 ? "管理密钥无效，请重新登录。" : "操作失败，请重试。");
  }
  const result = await response.json();
  if (current !== session) throw Error("登录状态已变化，请重新操作。");
  return result;
}

function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll("main button")) button.disabled = value;
  for (const form of document.querySelectorAll("main form")) form.setAttribute("aria-busy", String(value));
}

function run(operation, success = "已更新") {
  return async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    notify("处理中…", false, true);
    try {
      const result = await operation();
      if (result === false) notify("");
      else notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败，请重试。", true, true);
    } finally {
      setBusy(false);
    }
  };
}

function confirmRevoke(device) {
  const dialog = $("revoke-dialog");
  $("revoke-description").textContent = `“${device.name}”将失去访问权限，需要重新配对才能继续使用。`;
  dialog.returnValue = "cancel";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
    move(dialog, { opacity: [0, 1], scale: [0.94, 1] }, SPRING_FAST);
  });
}

function renderDevices(devices, now) {
  $("devices").replaceChildren();
  if (!devices.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "还没有设备。生成第一枚接入密钥，让 Rally 和你一起开始工作。";
    $("devices").append(empty);
  }
  for (const device of devices) {
    const row = document.createElement("div");
    row.className = "device-row";
    const avatar = document.createElement("span");
    avatar.className = "device-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = Array.from(device.name)[0] || "R";
    const info = document.createElement("div");
    info.className = "device-info";
    const name = document.createElement("span");
    name.className = "device-name";
    name.textContent = device.name;
    const meta = document.createElement("div");
    meta.className = "device-meta";
    const badge = document.createElement("span");
    badge.className = "status-chip";
    const recent = device.paired && now - device.seen < 45000;
    badge.dataset.state = !device.paired ? "pending" : recent ? "online" : "offline";
    badge.textContent = !device.paired ? "等待配对" : recent ? "最近在线" : "离线";
    meta.append(badge);
    if (device.paired && device.seen) {
      const last = document.createElement("small");
      last.textContent = `最近活动 ${new Date(device.seen).toLocaleString()}`;
      meta.append(last);
    }
    info.append(name, meta);
    const revoke = document.createElement("button");
    revoke.className = "danger small";
    revoke.textContent = "吊销";
    revoke.setAttribute("aria-label", `吊销 ${device.name}`);
    revoke.disabled = busy;
    revoke.onclick = run(async () => {
      if (!await confirmRevoke(device)) return false;
      await call("revoke", { id: device.id });
      clearIssued();
      await refresh();
    }, "已吊销设备访问权限");
    row.append(avatar, info, revoke);
    $("devices").append(row);
  }
}

async function refresh() {
  const state = await call("status");
  const now = Date.now();
  const firstLogin = $("panel").hidden;
  $("login").hidden = true;
  $("panel").hidden = false;
  $("logout").hidden = false;
  $("instance").textContent = `实例 ${state.instance}`;
  allows = state.pairing;
  $("pairing").setAttribute("aria-checked", String(allows));
  $("pairing-state").textContent = allows ? "接受新设备" : "已暂停新配对";
  $("pairing-state").dataset.state = allows ? "online" : "offline";
  move($("pairing").querySelector(".switch-thumb"), { x: allows ? 20 : 0 }, SPRING_FAST);
  const paired = state.devices.filter(device => device.paired).length;
  const recent = state.devices.filter(device => device.paired && now - device.seen < 45000).length;
  $("stat-total").textContent = String(state.devices.length);
  $("stat-paired").textContent = String(paired);
  $("stat-pending").textContent = String(state.devices.length - paired);
  $("stat-recent").textContent = String(recent);
  $("device-count").textContent = String(state.devices.length);
  $("updated").textContent = `更新于 ${new Date(now).toLocaleTimeString()} · 最近在线指 45 秒内有活动的已配对设备`;
  renderDevices(state.devices, now);
  if (firstLogin) move($("panel"), { opacity: [0, 1], y: [12, 0] }, SPRING_FAST);
}

$("auth").onsubmit = run(async () => {
  session++;
  key = $("admin").value.trim();
  $("admin").value = "";
  await refresh();
}, "已连接实例");
$("issue").onsubmit = run(async () => {
  const result = await call("issue", { name: $("name").value });
  $("issued").textContent = result.key;
  $("issued-panel").hidden = false;
  $("name").value = "";
  await refresh();
}, "接入密钥已生成");
$("refresh").onclick = run(refresh);
$("pairing").onclick = run(async () => {
  await call("pairing", { enabled: !allows });
  await refresh();
});
$("copy-key").onclick = async () => {
  const value = $("issued").textContent;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    notify("接入密钥已复制");
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("issued"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    notify("已选中密钥，请手动复制。");
  }
};
$("logout").onclick = exit;
