import { ChoiceSelect } from "../md3/Select";
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
      <label className="text-xs text-muted">教练模型<ChoiceSelect className={selectClass} value={selected ? JSON.stringify([selected.provider, selected.id]) : ""} onValueChange={choiceValue => {
        const model = models.find(item => JSON.stringify([item.provider, item.id]) === choiceValue);
        setState({ ...state, model: model ? { provider: model.provider, model: model.id, thinkingLevel: "off" } : null });
      }}><option value="">请选择模型</option>{models.map(model => <option key={JSON.stringify([model.provider, model.id])} value={JSON.stringify([model.provider, model.id])}>{model.providerName} · {model.name}</option>)}</ChoiceSelect></label>
      {state.enabled && !selected && <p className="text-xs text-muted">选择一个可用模型后，教练才会运行。</p>}
      {selected && state.model && <label className="text-xs text-muted">思考强度<ChoiceSelect className={selectClass} value={state.model.thinkingLevel} onValueChange={choiceValue => setState({ ...state, model: { ...state.model!, thinkingLevel: choiceValue as ThinkingLevelName } })}>{[...new Set(["off", ...selected.thinkingLevels])].map(level => <option key={level}>{level}</option>)}</ChoiceSelect></label>}
      <div className="flex flex-wrap gap-3"><label className="text-xs text-muted">静默开始<TimeField label="静默开始" value={state.quietStart} onChange={quietStart => setState({ ...state, quietStart })} /></label><label className="text-xs text-muted">静默结束<TimeField label="静默结束" value={state.quietEnd} onChange={quietEnd => setState({ ...state, quietEnd })} /></label></div>
      <label className="text-xs text-muted">点子频率<ChoiceSelect className={selectClass} value={state.ideasPerDay} onValueChange={choiceValue => setState({ ...state, ideasPerDay: Number(choiceValue) as 0 | 1 | 2 })}><option value={0}>不主动</option><option value={1}>每天 1 次</option><option value={2}>每天 2 次</option></ChoiceSelect></label>
      <Button onClick={() => void save()} disabled={busy}>保存</Button>
    </fieldset>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [hour, minute] = value.split(":");
  return <span className="mt-1 flex items-center gap-1">
    <ChoiceSelect aria-label={`${label}小时`} value={hour} onValueChange={next => onChange(`${next}:${minute}`)} options={Array.from({ length: 24 }, (_, i) => ({ value: String(i).padStart(2, "0"), label: String(i).padStart(2, "0") }))} />
    <span aria-hidden="true">:</span>
    <ChoiceSelect aria-label={`${label}分钟`} value={minute} onValueChange={next => onChange(`${hour}:${next}`)} options={Array.from({ length: 60 }, (_, i) => ({ value: String(i).padStart(2, "0"), label: String(i).padStart(2, "0") }))} />
  </span>;
}
