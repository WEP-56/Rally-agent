import { ActionButton } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_JELLY, SPRING_LAYOUT } from "../md3/springs";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { QqMailState } from "../../../shared/connections";
import { cn } from "../utils/cn";
import { timeAgo } from "./status";
import { Button, Input } from "./ui";
import { ConnectorTools } from "./ConnectorTools";

const label = { disconnected: "未连接", checking: "验证中", connected: "已连接", error: "连接异常" } as const;

export function QqMailCard({ visible }: { visible: boolean }) {
  const api = window.rally.qqMail;
  const [state, setState] = useState<QqMailState>();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [authorizationCode, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void api.getState().then(value => { if (active) setState(value); }).catch(() => {});
    return () => { active = false; };
  }, [api, visible]);

  async function action(run: () => Promise<QqMailState>) {
    setPending(true); setError("");
    try { setState(await run()); }
    catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method .*?: Error: /, "") : "操作未完成，请重试。");
      await api.getState().then(setState).catch(() => {});
    } finally { setPending(false); }
  }

  const status = pending ? "checking" : state?.status ?? "disconnected";
  const configured = Boolean(state?.address);
  return <div className="glass mt-3 overflow-hidden rounded-[26px]">
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-md-surface-low text-[15px] font-semibold text-[#4a8fe7]">@</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="text-[14px] font-medium">QQ 邮箱</span><span className="hidden text-[11px] text-faint sm:inline">邮箱</span></div>
        <div className="mt-0.5 truncate text-[12px] text-muted">{state?.address ?? "收件箱、附件与邮件发送"}</div>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted" role="status">
        {status === "checking" ? <LoaderCircle size={12} className="animate-spin" /> : <span className={cn("h-1.5 w-1.5 rounded-full", status === "connected" ? "bg-ok" : status === "error" ? "bg-danger" : "bg-faint")} />}{label[status]}
      </span>
      <ActionButton type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setCode(""); }} className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-md-surface-low px-3 text-[12px] font-medium text-fg hover:bg-hover">
        {configured ? "管理" : "连接"}<motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={SPRING_JELLY} className="flex items-center"><ChevronDown size={13} /></motion.span>
      </ActionButton>
    </div>
    <AnimatePresence initial={false}>{expanded && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING_LAYOUT} className="overflow-hidden  px-4 pb-4 pt-3.5 text-[12.5px]">
      {editing || !configured ? <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        const code = authorizationCode; setCode("");
        void action(async () => { const next = await api.save({ address, authorizationCode: code }); setEditing(false); return next; });
      }}>
        <p className="leading-relaxed text-muted">登录 <a className="text-accent underline" href="https://mail.qq.com/" target="_blank" rel="noreferrer">QQ 邮箱</a>，在设置中开启 IMAP/SMTP 服务并生成授权码。连接时只验证登录。</p>
        <label className="block space-y-1"><span>QQ 邮箱地址</span><Input type="email" required placeholder="name@qq.com" value={address} onChange={event => setAddress(event.target.value)} autoComplete="off" /></label>
        <label className="block space-y-1"><span>邮箱授权码</span><Input type="password" required value={authorizationCode} onChange={event => setCode(event.target.value)} autoComplete="new-password" /></label>
        <div className="flex justify-end gap-2">
          {configured && <Button type="button" size="sm" disabled={pending} onClick={() => { setEditing(false); setCode(""); setError(""); }}>取消</Button>}
          <Button type="submit" size="sm" variant="primary" disabled={pending || !address.trim() || !authorizationCode.trim()}>验证并连接</Button>
        </div>
      </form> : <div className="space-y-3">
        <div><div className="font-medium">Worker 邮箱工具</div><p className="mt-1 leading-relaxed text-muted">读取和检索收件箱、保存附件、发送或回复邮件。发送默认需要你确认，可在下方调整权限。新建或重新启动的 Worker 会加载工具。</p></div>
        <div className="flex flex-wrap items-center gap-2  pt-3">
          <span className="mr-auto text-[11px] text-faint">{state?.checkedAt ? `最近验证 ${timeAgo(state.checkedAt)}` : "已保存配置，使用时连接"}</span>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setAddress(state?.address ?? ""); setEditing(true); setError(""); }}>更换凭据</Button>
          <Button size="sm" disabled={pending} onClick={() => void action(api.verify)}>验证连接</Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => { setAddress(""); setCode(""); void action(api.disconnect); }}>断开连接</Button>
        </div>
      </div>}
      <ConnectorTools connector="qqmail" visible={visible} available={configured} />
      {(error || state?.error) && <p role="alert" className="mt-3 text-danger">{error || state?.error}</p>}
    </motion.div>}</AnimatePresence>
  </div>;
}
