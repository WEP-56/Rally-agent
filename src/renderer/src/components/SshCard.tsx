import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { SshServer, SshServerInput, SshVerification } from "../../../shared/ssh";
import { ActionButton } from "../md3/interactive";
import { SPRING_JELLY, SPRING_LAYOUT } from "../md3/springs";
import { Button, Input, Select, Textarea } from "./ui";
import { ConnectorTools } from "./ConnectorTools";
import { timeAgo } from "./status";

const empty: SshServerInput = { name: "", host: "", port: 22, username: "", auth: "password" };

export function SshCard({ visible }: { visible: boolean }) {
  const api = window.rally.ssh;
  const [servers, setServers] = useState<SshServer[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<SshServerInput>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState<{ id: string; result: SshVerification }>();
  const [deleting, setDeleting] = useState<string>();

  useEffect(() => {
    if (!visible) { setDraft(undefined); setVerification(undefined); return; }
    let active = true;
    const reload = () => { void api.getState().then(value => { if (active) setServers(value); }).catch(reason => { if (active) setError(String(reason)); }); };
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === "ssh") reload(); };
    reload();
    window.addEventListener("rally-configuration", changed);
    window.addEventListener("focus", reload);
    return () => { active = false; window.removeEventListener("rally-configuration", changed); window.removeEventListener("focus", reload); };
  }, [api, visible]);

  async function action(run: () => Promise<void>) {
    setPending(true); setError("");
    try { await run(); setServers(await api.getState()); }
    catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method .*?: Error: /, "") : "操作未完成，请重试。"); }
    finally { setPending(false); }
  }

  async function verify(id: string, fingerprint?: string) {
    setVerification(undefined);
    const result = await api.verify(id, fingerprint);
    setVerification({ id, result });
  }

  return <div className="glass mt-3 overflow-hidden rounded-[26px]">
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] bg-md-surface-low text-accent"><Server size={22} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">SSH</div>
        <div className="mt-0.5 truncate text-[12px] text-muted">{servers.length ? `${servers.length} 台服务器，${servers.filter(server => server.enabled).length} 台已启用` : "让助手连接服务器，执行维护任务"}</div>
      </div>
      <ActionButton type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setDraft(undefined); setVerification(undefined); }} className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-md-surface-low px-3 text-[12px] font-medium text-fg hover:bg-hover">
        管理<motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={SPRING_JELLY} className="flex items-center"><ChevronDown size={13} /></motion.span>
      </ActionButton>
    </div>
    <AnimatePresence initial={false}>{expanded && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING_LAYOUT} className="overflow-hidden px-4 pb-4 pt-3.5 text-[12.5px]">
      <p className="mb-3 leading-relaxed text-muted">服务器由运行助手的机器连接。保存后测试连接，即可让内置 Worker 执行命令。密码与私钥加密保存。</p>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        {servers.map(server => <div key={server.id} className="min-w-0 space-y-2 rounded-2xl bg-md-surface-low p-3">
          <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{server.name}</span><span className="shrink-0 text-xs text-muted">{server.enabled ? "已启用" : "已停用"}</span></div>
          <p className="break-all font-mono text-[11px] text-muted">{server.username}@{server.host}:{server.port}</p>
          <p className="text-[11px] text-faint">{server.checkedAt ? `最近验证 ${timeAgo(server.checkedAt)}` : server.fingerprint ? "已确认指纹，尚未验证登录" : "请测试连接并确认指纹"}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void action(() => verify(server.id))}>测试连接</Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft({ id: server.id, name: server.name, host: server.host, port: server.port, username: server.username, auth: server.auth }); setVerification(undefined); setError(""); }}>编辑</Button>
            <Button size="sm" variant="ghost" onClick={() => void action(async () => { await api.update(server.id, !server.enabled); setVerification(undefined); })}>{server.enabled ? "停用" : "启用"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(server.id)}>删除</Button>
          </div>
          {deleting === server.id && <div className="space-y-2">
            <p className="text-muted">删除配置并关闭这台服务器的连接？远程程序可能仍在运行。</p>
            <div className="flex gap-2"><Button size="sm" onClick={() => setDeleting(undefined)}>取消</Button><Button size="sm" variant="danger" onClick={() => void action(async () => { await api.remove(server.id); setDeleting(undefined); setVerification(undefined); if (draft?.id === server.id) setDraft(undefined); })}>删除配置</Button></div>
          </div>}
          {verification?.id === server.id && (verification.result.status === "verified" ? <p role="status" className="text-ok">连接验证成功</p> : <div className="space-y-2 rounded-xl bg-sunken p-3">
            <p className="font-medium">{verification.result.previousFingerprint ? "服务器指纹已变化" : "首次连接：确认服务器指纹"}</p>
            <p className="text-xs text-muted">请与服务器提供的信息核对，确认后再发送登录凭据。</p>
            {verification.result.previousFingerprint && <p className="break-all font-mono text-[10px] text-faint">原指纹：{verification.result.previousFingerprint}</p>}
            <p className="break-all font-mono text-[11px]">{verification.result.fingerprint}</p>
            <Button size="sm" variant="primary" onClick={() => void action(() => verify(server.id, verification.result.fingerprint))}>确认并验证登录</Button>
          </div>)}
        </div>)}
        {!draft && <Button size="sm" onClick={() => { setDraft({ ...empty }); setError(""); }}>添加服务器</Button>}
        {draft && <form className="space-y-3 rounded-2xl bg-sunken p-3" onSubmit={event => {
          event.preventDefault();
          const input = draft;
          void action(async () => { await api.save(input); setDraft(undefined); setVerification(undefined); });
        }}>
          <div className="font-medium">{draft.id ? "编辑服务器" : "添加服务器"}</div>
          <label className="block space-y-1"><span>名称</span><Input required maxLength={200} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="我的 VPS" /></label>
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
            <label className="block min-w-0 space-y-1"><span>地址</span><Input required value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} placeholder="IP 或域名" autoComplete="off" /></label>
            <label className="block space-y-1"><span>端口</span><Input required type="number" min={1} max={65535} value={draft.port} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} /></label>
          </div>
          <label className="block space-y-1"><span>用户名</span><Input required value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} autoComplete="off" /></label>
          <div className="space-y-1"><span>认证方式</span><Select value={draft.auth} options={[{ value: "password", label: "密码" }, { value: "privateKey", label: "私钥" }]} onChange={value => { if (value === "password" || value === "privateKey") setDraft({ ...draft, auth: value, secret: undefined, passphrase: undefined }); }} /></div>
          <label className="block space-y-1"><span>{draft.auth === "password" ? "密码" : "私钥内容"}{draft.id ? "（留空保留）" : ""}</span>
            {draft.auth === "password" ? <Input type="password" autoComplete="new-password" required={!draft.id} value={draft.secret ?? ""} onChange={event => setDraft({ ...draft, secret: event.target.value || undefined })} />
              : <Textarea rows={5} required={!draft.id} spellCheck={false} autoComplete="off" value={draft.secret ?? ""} onChange={event => setDraft({ ...draft, secret: event.target.value || undefined })} placeholder="粘贴完整私钥，或从下方导入文件" className="font-mono text-xs" />}
          </label>
          {draft.auth === "privateKey" && <>
            <label className="block space-y-1"><span>从文件导入私钥</span><input type="file" className="block max-w-full text-xs" onChange={event => {
              const file = event.target.files?.[0]; event.target.value = "";
              if (!file) return;
              if (file.size > 65536) { setError("私钥文件不能超过 64 KiB"); return; }
              void action(async () => { const secret = await file.text(); setDraft(current => current ? { ...current, secret } : current); });
            }} /></label>
            <label className="block space-y-1"><span>私钥口令（可选）</span><Input type="password" autoComplete="new-password" value={draft.passphrase ?? ""} onChange={event => setDraft({ ...draft, passphrase: event.target.value })} placeholder={draft.id ? "不修改时保留原口令；输入后清空可移除" : ""} /></label>
          </>}
          <div className="flex justify-end gap-2"><Button type="button" size="sm" onClick={() => { setDraft(undefined); setError(""); }}>取消</Button><Button type="submit" size="sm" variant="primary">保存</Button></div>
        </form>}
      </fieldset>
      {pending && <p role="status" className="mt-3 text-muted">正在处理…</p>}
      {error && <p role="alert" className="mt-3 break-words text-danger">{error}</p>}
      <ConnectorTools connector="ssh" visible={visible && expanded} available={servers.some(server => server.enabled)} />
      <p className="mt-2 text-[11px] text-faint">继续会话时，读取输出无需审批；发送输入按所选权限执行。</p>
    </motion.div>}</AnimatePresence>
  </div>;
}
