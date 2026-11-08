import { Fragment, type ReactNode } from "react";
import { useApp } from "../store";

function inline(text: string, key: string, onLink: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]|https?:\/\/[^\s）)，,]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("`")) {
      out.push(
        <code key={k} className="mx-0.5 rounded-md bg-sunken px-1.5 py-px font-mono text-[0.9em]">
          {t.slice(1, -1)}
        </code>,
      );
    } else if (t.startsWith("**")) {
      out.push(<strong key={k} className="font-semibold">{t.slice(2, -2)}</strong>);
    } else if (t.startsWith("[")) {
      out.push(
        <span key={k} className="mx-0.5 rounded-md bg-accent-soft px-1.5 py-px font-medium text-accent">
          {t.slice(1, -1)}
        </span>,
      );
    } else {
      out.push(
        <button key={k} onClick={() => onLink(t)} className="cursor-pointer break-all text-accent hover:underline">
          {t}
        </button>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const { openTab } = useApp();
  const paras = text.split(/\n{2,}/);
  return (
    <div className={className}>
      {paras.map((p, pi) => (
        <p key={pi} className="selectable mb-2.5 last:mb-0">
          {p.split("\n").map((line, li, arr) => (
            <Fragment key={li}>
              {inline(line, `${pi}-${li}`, (url) => openTab("browser", { url }))}
              {li < arr.length - 1 && <br />}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
