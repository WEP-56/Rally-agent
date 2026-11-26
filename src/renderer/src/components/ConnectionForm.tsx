import { motion } from "motion/react";
import { SPRING_FAST } from "../md3/springs";
import { useBrowserOverlay } from "../browser-overlays";
import { ActionButton } from "../md3/interactive";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Cloud, LoaderCircle, Monitor } from "lucide-react";
import { connectionUrl } from "../../../shared/connection";
import { bridge } from "../connection";
import { cn } from "../utils/cn";
import { Button, Input } from "./ui";

export function ConnectionForm({ reason = "", onContinue }: { reason?: string; onContinue?: () => void }) {
  const state = window.runtime;
  const desktop = state?.platform === "desktop";
  const profilesId = useId();
  const [mode, setMode] = useState<"local" | "cloud">(desktop && state?.mode !== "cloud" ? "local" : "cloud");
  const [url, setUrl] = useState(state?.url ?? "");
  const [key, setKey] = useState("");
  const [error, setError] = useState(reason || state?.error || "");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmationId = useId();
  useBrowserOverlay(confirming);
  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);
  let normalized = "";
  try { normalized = connectionUrl(url); } catch { /* Validation is shown on submit. */ }
  const paired = state?.profiles?.includes(normalized);
  const unchanged = mode === state?.mode && (mode === "local" || (normalized === state.url && !key.trim()));

  async function select(confirmed = false) {
    if (busy) return;
    if (unchanged && onContinue) { onContinue(); return; }
    if (state?.mode === "local" && mode === "cloud" && !confirmed) { setConfirming(true); return; }
    setConfirming(false);
    setError("");
    try {
      const address = mode === "cloud" ? connectionUrl(url) : "";
      if (!bridge) throw Error("连接接口不可用，请重新启动 Rally。");
      if (mode === "cloud" && !key.trim() && !paired) throw Error("请填写部署控制台生成的一次性设备接入密钥。");
      setBusy(true);
      await bridge.select(mode, address, key.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section className="w-full space-y-5" aria-label="运行模式">
      {state?.mode !== "choose" && (
        <div className="rounded-2xl bg-accent-soft p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-accent">
            {state?.mode === "cloud" ? <Cloud size={17} /> : <Monitor size={17} />}
            当前使用{state?.mode === "cloud" ? "云端模式" : "本地模式"}
          </div>
          <p className="mt-2 break-all text-xs leading-relaxed text-muted">{state?.mode === "cloud" ? state.url : "Agent、任务和文件都在这台电脑上。"}</p>
          {state?.mode === "cloud" && <p className="mt-1 break-all text-xs text-muted">服务器实例：{state.instance}</p>}
        </div>
      )}
      {desktop ? (
        <div className="grid grid-cols-2 gap-3" role="group" aria-label="选择运行位置">
          {([
            { value: "local", title: "本地运行", icon: Monitor, desc: "使用这台电脑的文件与工具，电脑运行时执行任务。" },
            { value: "cloud", title: "连接云端", icon: Cloud, desc: "任务在服务器持续运行，电脑和手机共享同一套 Rally。" },
          ] as const).map(item => (
            <ActionButton key={item.value} type="button" disabled={busy} aria-pressed={mode === item.value}
              onClick={() => { setMode(item.value); setError(""); }}
              className={cn("rounded-2xl p-4 text-left transition-colors disabled:opacity-50", mode === item.value ? "bg-md-secondary-container text-md-on-secondary-container" : "bg-panel hover:bg-hover")}>
              <div className="mb-3 flex items-center justify-between text-accent"><item.icon size={22} />{mode === item.value && <Check size={16} />}</div>
              <div className="text-sm font-semibold">{item.title}</div>
              <p className="mt-2 text-xs leading-relaxed text-muted">{item.desc}</p>
            </ActionButton>
          ))}
        </div>
      ) : <p className="text-sm leading-relaxed text-muted">手机连接云端 Rally，与电脑共享对话和任务。</p>}
      <form onSubmit={event => { event.preventDefault(); void select(); }} className="space-y-4" aria-busy={busy}>
        {mode === "cloud" && <>
          <label className="block space-y-2 text-sm font-medium">
            <span>服务器地址</span>
            <Input required type="url" autoComplete="url" disabled={busy} placeholder="https://rally.example.com 或 http://IP:4711" value={url} onChange={e => { setUrl(e.target.value); setKey(""); }} />
          </label>
          <div id={profilesId} className="flex flex-wrap gap-2">{state?.profiles?.map(profile => <ActionButton key={profile} disabled={busy} onClick={() => { setUrl(profile); setKey(""); }} className="max-w-full truncate rounded-full bg-md-secondary-container px-3 py-1.5 text-xs text-md-on-secondary-container" title={profile}>{profile}</ActionButton>)}</div>
          <label className="block space-y-2 text-sm font-medium">
            <span>设备接入密钥</span>
            <Input type="password" autoComplete="off" disabled={busy} required={!paired} placeholder={paired ? "已配对，可留空；重新配对时填写新密钥" : "粘贴一次性设备接入密钥"} value={key} onChange={e => setKey(e.target.value)} />
          </label>
          <p className="text-xs leading-relaxed text-muted">在服务器部署控制台生成设备接入密钥。配对后由此设备安全保存连接凭据。</p>
          {normalized.startsWith("http://") && <p className="text-xs text-muted">当前使用 HTTP 测试连接，传输内容不会加密。</p>}
        </>}
        <p className="text-xs leading-relaxed text-muted">
          {state?.mode === "local" && mode === "cloud" ? "切换会停止本地运行中的工作。" : state?.mode === "cloud" ? "切换连接或退出客户端不会停止服务器任务。" : "之后可以在设置 → 运行模式中切换。"}
          {desktop && " 本地与各服务器的配置、对话和文件独立保存，不会自动迁移。"}
        </p>
        {error && <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger break-words">{error}</p>}
        <div className="flex justify-end">
          <Button variant="primary" size="lg" disabled={busy || (unchanged && !onContinue && !reason)}>
            {busy ? <><LoaderCircle size={16} className="animate-spin" />{mode === "cloud" ? "验证连接并切换…" : "正在进入本地…"}</> : <>{unchanged ? onContinue ? "继续设置" : reason ? "重新连接" : "正在使用" : mode === "cloud" ? state?.mode === "cloud" ? "验证并更新连接" : "连接云端" : "使用本地模式"}<ArrowRight size={15} /></>}
          </Button>
        </div>
      </form>
      <motion.dialog ref={dialog} aria-labelledby={confirmationId} onCancel={event => { event.preventDefault(); setConfirming(false); }} initial={false} animate={{ opacity: confirming ? 1 : 0, scale: confirming ? 1 : 0.94 }} transition={SPRING_FAST}
        className="m-auto w-[min(400px,90vw)] rounded-[28px] bg-md-surface-high p-6 text-md-on-surface shadow-pop backdrop:bg-black/30">
        <h2 id={confirmationId} className="text-lg font-semibold">切换到云端？</h2>
        <p className="my-4 text-sm leading-relaxed text-muted">切换会退出本地 Rally，并停止本地运行中的工作。</p>
        <div className="flex justify-end gap-2"><Button type="button" onClick={() => setConfirming(false)}>取消</Button><Button type="button" variant="primary" onClick={() => void select(true)}>继续切换</Button></div>
      </motion.dialog>
    </section>
  );
}
