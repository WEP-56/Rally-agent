import { ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ImBotState } from "../../../shared/connections";
import type { RallyApi } from "../../../shared/ipc";
import { cn } from "../utils/cn";
import { QqMailCard } from "./QqMailCard";
import { ConnectorTools } from "./ConnectorTools";
import { timeAgo } from "./status";
import { Button, Input, Toggle } from "./ui";

const STATUS = { disconnected: "未连接", connecting: "连接中", connected: "已连接", reconnecting: "重连中", error: "连接失败" } as const;

type BotCardProps = {
  visible: boolean;
  name: string;
  mark: string;
  color: string;
  summary: string;
  portal: string;
  appIdHint: string;
  instructions: string;
  api: RallyApi["qqBot"] | RallyApi["feishu"];
};

function BotCard({ visible, name, mark, color, summary, portal, appIdHint, instructions, api }: BotCardProps) {
  const [state, setState] = useState<ImBotState>();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const poll = () => void api.getState().then(next => { if (active) setState(next); }).catch(() => {});
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, visible]);

  async function action(run: () => Promise<ImBotState>): Promise<void> {
    setError("");
    setPending(true);
    try { setState(await run()); }
    catch (err) { setError(err instanceof Error ? err.message.replace(/^Error invoking remote method .*?: Error: /, "") : "操作未完成，请重试。"); }
    finally { setPending(false); }
  }

  const status = state?.status ?? "disconnected";
  const connecting = status === "connecting" || status === "reconnecting";
  const configured = Boolean(state?.appId);
  const showForm = editing || !configured;
  return (
    <div className="glass overflow-hidden rounded-[20px]">
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-line bg-panel text-[15px] font-semibold" style={{ color }}>{mark}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="text-[14px] font-medium">{name}</span><span className="hidden text-[11px] text-faint sm:inline">消息与协作</span></div>
          <div className="mt-0.5 truncate text-[12px] text-muted">{state?.botName ?? summary}</div>
        </div>
        {state && <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted" role="status">
          {connecting ? <LoaderCircle size={12} className="animate-spin" /> : <span className={cn("h-1.5 w-1.5 rounded-full", status === "connected" ? "bg-ok" : status === "error" ? "bg-danger" : "bg-faint")} />}{STATUS[status]}
        </span>}
        <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-line px-3 text-[12px] font-medium text-fg hover:bg-hover">
          {configured ? "管理" : "连接"}<ChevronDown size={13} className={cn("transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded && <div className="animate-fade border-t border-line px-4 pb-4 pt-3.5 text-[12.5px]">
        {showForm ? <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          void action(async () => {
            const next = await api.save({ appId, appSecret });
            setAppSecret(""); setEditing(false);
            return next;
          });
        }}>
          <p className="leading-relaxed text-muted">在 <a className="text-accent underline" href={portal} target="_blank" rel="noreferrer">{name}开放平台</a> {instructions}</p>
          <label className="block space-y-1"><span>App ID</span><Input required placeholder={appIdHint} value={appId} onChange={event => setAppId(event.target.value)} autoComplete="off" /></label>
          <label className="block space-y-1"><span>App Secret</span><Input required type="password" value={appSecret} onChange={event => setAppSecret(event.target.value)} autoComplete="new-password" /></label>
          <div className="flex justify-end gap-2">
            {configured && <Button type="button" size="sm" onClick={() => { setEditing(false); setAppSecret(""); }}>取消</Button>}
            <Button type="submit" variant="primary" size="sm" disabled={pending || !appId.trim() || !appSecret.trim()}>保存并连接</Button>
          </div>
        </form> : <div className="space-y-3">
          <div className="text-[11px] text-faint">{state?.appId}</div>
          <div className="flex items-center justify-between gap-3">
            <div><div className="font-medium">同步主对话</div><p className="mt-1 text-muted">{state?.paired ? "已配对。向机器人发送单聊文本即可继续主对话。" : `先配对${name}账号，再通过机器人继续主对话。`}</p></div>
            {!state?.paired && <Button size="sm" disabled={pending || status !== "connected"} onClick={() => void action(api.pair)}>{state?.pairing ? "刷新配对码" : "生成配对码"}</Button>}
          </div>
          {state?.pairing && <div className="rounded-xl bg-sunken px-3 py-2.5 text-muted">在 5 分钟内单聊机器人并发送 <code className="select-all text-fg">/pair {state.pairing.code}</code></div>}
          {"setTools" in api && <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div><div className="font-medium">允许 Worker 使用飞书工具</div><p className="mt-1 leading-relaxed text-muted">只读访问已共享给应用的文档、知识库和多维表格。新建或重新启动的 Worker 会加载工具。</p></div>
            <Toggle label="允许 Worker 使用飞书工具" checked={state != null && "tools" in state && state.tools === true} disabled={pending || !state?.paired} onChange={enabled => void action(() => api.setTools(enabled))} />
          </div>}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="mr-auto text-[11px] text-faint">最近消息 {state?.lastMessageAt ? timeAgo(state.lastMessageAt) : "暂无"}</span>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setAppId(state?.appId ?? ""); setEditing(true); }}>更换凭据</Button>
            {status !== "connected" && <Button size="sm" disabled={pending || connecting} onClick={() => void action(api.retry)}>重连</Button>}
            <Button size="sm" variant="danger" disabled={pending} onClick={() => { setAppId(""); setAppSecret(""); void action(api.disconnect); }}>断开连接</Button>
          </div>
        </div>}
        {"setTools" in api && <ConnectorTools connector="feishu" visible={visible} available={state != null && "tools" in state && state.tools === true} />}
        {(error || state?.error) && <p role="alert" className="mt-3 text-danger">{error || state?.error}</p>}
      </div>}
    </div>
  );
}

export function ConnectionsView({ visible }: { visible: boolean }) {
  return (
    <div className="h-full overflow-y-auto px-4 pb-6 sm:px-6">
      <div className="animate-rise mx-auto max-w-[680px]">
        <header className="mb-5 pt-1">
          <h1 className="font-display text-[25px] font-semibold leading-tight">连接</h1>
          <p className="mt-1.5 text-[12.5px] text-muted">连接外部应用，管理它们提供的工具与权限，在你常用的地方继续和 Rally 协作。</p>
        </header>
        <BotCard visible={visible} name="飞书" mark="飞" color="#3370ff" summary="机器人单聊、云文档与多维表格" portal="https://open.feishu.cn/app" appIdHint="cli_…"
          api={window.rally.feishu} instructions="创建企业自建应用并启用机器人。选择使用长连接接收事件，添加「接收消息」事件，开通单聊收消息和机器人发消息权限后发布。平台要求先建长连接时，可以先在这里保存，再回平台完成订阅。" />
        <QqMailCard visible={visible} />
        <div className="mt-3"><BotCard visible={visible} name="QQ" mark="QQ" color="#3799ff" summary="官方机器人单聊" portal="https://q.qq.com/" appIdHint="机器人 AppID"
          api={window.rally.qqBot} instructions="创建机器人并获取 AppID 和 AppSecret。新版管理端支持机器人管理员直接测试私聊；其他体验账号可在「开发设置」添加。Rally 使用长连接接收私聊消息。" /></div>
      </div>
    </div>
  );
}
