import { useEffect, useRef, useState } from "react";
import type { ConnectorId, ConnectorToolSettings } from "../../../shared/connections";
import type { McpRiskTier } from "../../../shared/mcp";
import { Button } from "./ui";

export function ConnectorTools({ connector, visible, available }: { connector: ConnectorId; visible: boolean; available: boolean }) {
  const [tools, setTools] = useState<ConnectorToolSettings[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const current = ++request.current;
    setBusy(true);
    void window.rally.connectorTools.getState(connector)
      .then(next => { if (current === request.current) { setTools(next); setError(""); } })
      .catch(reason => { if (current === request.current) setError(String(reason)); })
      .finally(() => { if (current === request.current) setBusy(false); });
    const reload = () => setRefresh(value => value + 1);
    const changed = (event: Event) => { if (["connector-tools", "mcp"].includes((event as CustomEvent<string>).detail)) reload(); };
    window.addEventListener("rally-configuration", changed);
    window.addEventListener("focus", reload);
    return () => { request.current++; window.removeEventListener("rally-configuration", changed); window.removeEventListener("focus", reload); };
  }, [connector, visible, refresh]);

  async function setTier(name: string, tier: McpRiskTier) {
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      const next = await window.rally.connectorTools.setTier(connector, name, tier);
      if (current === request.current) setTools(next);
    } catch (reason) {
      if (current === request.current) setError(String(reason));
    } finally { if (current === request.current) setBusy(false); }
  }

  return <div className="mt-3 space-y-2 border-t border-line pt-3">
    <div className="flex items-center justify-between gap-2"><div className="font-medium">工具权限</div><Button size="sm" variant="ghost" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新</Button></div>
    <p className="text-[12px] leading-relaxed text-muted">可逆：直接执行；有对外代价：执行并提示、留记录；不可逆：等待确认。保存后从下一次调用起生效，已经发出的确认仍需处理。</p>
    {!available && <p className="text-[11px] text-faint">连接并启用工具后可使用，也可以先设置权限。</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-2">
      {tools.map(tool => <div key={tool.name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken px-3 py-2">
        <div className="min-w-0 flex-1"><div className="text-[12px]">{tool.label}</div><div className="mt-0.5 break-all font-mono text-[10px] text-faint">{tool.name}</div></div>
        <select aria-label={`${tool.label} 风险档`} value={tool.tier} onChange={event => void setTier(tool.name, event.target.value as McpRiskTier)} className="rounded-md bg-panel px-2 py-1 text-xs">
          <option value="reversible">可逆</option><option value="external">有对外代价</option><option value="irreversible">不可逆</option>
        </select>
      </div>)}
    </fieldset>
    {busy && tools.length === 0 && <p role="status" className="text-xs text-faint">正在读取工具权限…</p>}
    {error && <p role="alert" className="break-words text-xs text-danger">{error}</p>}
  </div>;
}
