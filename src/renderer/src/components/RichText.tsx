import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { httpAddress } from "../../../shared/browser";
import { useApp } from "../store";

/** Message links use the same address policy as the native browser. */
function messageUrl(value: string): string {
  try { return httpAddress(value); } catch { return ""; }
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const { openTab } = useApp();
  return <div className={`rally-markdown selectable min-w-0 ${className ?? ""}`}>
    <Markdown remarkPlugins={[remarkGfm]} urlTransform={messageUrl} components={{
      a: ({ href, children, title }) => href
        ? <button type="button" title={title ?? href} onClick={() => openTab("browser", { url: href })} className="cursor-pointer text-left text-accent hover:underline">{children}</button>
        : <span>{children}</span>,
      // Open images deliberately instead of fetching remote content while rendering messages.
      img: ({ src, alt }) => typeof src === "string" && src
        ? <button type="button" title={src} onClick={() => openTab("browser", { url: src })} className="cursor-pointer text-accent hover:underline">{alt || "查看图片"}</button>
        : <span>{alt || "图片"}</span>,
      table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
    }}>{text}</Markdown>
  </div>;
}
