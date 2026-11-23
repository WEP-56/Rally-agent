import { useEffect, useState } from "react";
import type { CoachSettings } from "../../../shared/coach";
import type { ModelSummary, ThinkingLevelName } from "../../../shared/models";
import { Button, Input, Toggle } from "./ui";

export function CoachForm() {
  const [state, setState] = useState<CoachSettings>();
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([window.rally.coach.getState(), window.rally.models.getState()]).then(([settings, available]) => {
      if (active) { setState(settings); setModels(available.available); }
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  const selected = models.find(model => model.provider === state?.model?.provider && model.id === state?.model?.model);
  const selectClass = "w-full rounded-xl bg-sunken px-3 py-2 text-sm text-fg";
  async function save() {
    setBusy(true); setError("");
    try { setState(await window.rally.coach.update(state!)); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-4">
    <p className="text-xs leading-relaxed text-muted">教练在空闲时整理记忆，把值得聊的点子交给 Rally。时间按运行机器的本地时区计算{window.runtime.mode === "cloud" ? "（当前为服务器时间）" : ""}。</p>
    {state && <fieldset disabled={busy} className="flex flex-col gap-4">
      <Toggle label="启用教练" checked={state.enabled} onChange={enabled => setState({ ...state, enabled })} />
      <label className="text-xs text-muted">教练模型<select className={selectClass} value={selected ? JSON.stringify([selected.provider, selected.id]) : ""} onChange={event => {
        const model = models.find(item => JSON.stringify([item.provider, item.id]) === event.target.value);
        setState({ ...state, model: model ? { provider: model.provider, model: model.id, thinkingLevel: "off" } : null });
      }}><option value="">请选择模型</option>{models.map(model => <option key={JSON.stringify([model.provider, model.id])} value={JSON.stringify([model.provider, model.id])}>{model.providerName} · {model.name}</option>)}</select></label>
      {state.enabled && !selected && <p className="text-xs text-muted">选择一个可用模型后，教练才会运行。</p>}
      {selected && state.model && <label className="text-xs text-muted">思考强度<select className={selectClass} value={state.model.thinkingLevel} onChange={event => setState({ ...state, model: { ...state.model!, thinkingLevel: event.target.value as ThinkingLevelName } })}>{[...new Set(["off", ...selected.thinkingLevels])].map(level => <option key={level}>{level}</option>)}</select></label>}
      <div className="flex flex-wrap gap-3"><label className="text-xs text-muted">静默开始<Input type="time" value={state.quietStart} onChange={event => setState({ ...state, quietStart: event.target.value })} /></label><label className="text-xs text-muted">静默结束<Input type="time" value={state.quietEnd} onChange={event => setState({ ...state, quietEnd: event.target.value })} /></label></div>
      <label className="text-xs text-muted">点子频率<select className={selectClass} value={state.ideasPerDay} onChange={event => setState({ ...state, ideasPerDay: Number(event.target.value) as 0 | 1 | 2 })}><option value={0}>不主动</option><option value={1}>每天 1 次</option><option value={2}>每天 2 次</option></select></label>
      <Button onClick={() => void save()} disabled={busy}>保存</Button>
    </fieldset>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
