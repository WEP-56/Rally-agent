import type { ModelSummary, ThinkingLevelName } from "../../../shared/models";
import { ChoiceSelect } from "../md3/Select";

const LEVEL_LABEL: Record<string, string> = {
  off: "关闭", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
};

export function ModelPicker({ models, model, thinkingLevel, onSelect }: {
  models: ModelSummary[];
  model: string | null;
  thinkingLevel: string | null;
  onSelect: (provider: string, model: string, level?: ThinkingLevelName) => void;
}) {
  const current = models.find(entry => `${entry.provider}/${entry.id}` === model);
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <ChoiceSelect aria-label="选择模型" value={model ?? ""} placeholder={models.length ? "选择模型" : "请先添加供应商"}
      className="max-w-[240px] text-xs" disabled={!models.length}
      options={models.map(entry => ({ value: `${entry.provider}/${entry.id}`, label: entry.name, group: entry.providerName }))}
      onValueChange={value => {
        const next = models.find(entry => `${entry.provider}/${entry.id}` === value);
        if (next) onSelect(next.provider, next.id, next === current ? thinkingLevel as ThinkingLevelName : undefined);
      }} />
    {current?.reasoning && current.thinkingLevels.length > 0 && <ChoiceSelect aria-label="思考强度" value={thinkingLevel ?? ""} placeholder="思考强度"
      className="text-xs" options={current.thinkingLevels.map(level => ({ value: level, label: LEVEL_LABEL[level] ?? level }))}
      onValueChange={value => {
        const level = current.thinkingLevels.find(level => level === value);
        if (level) onSelect(current.provider, current.id, level);
      }} />}
  </div>;
}
