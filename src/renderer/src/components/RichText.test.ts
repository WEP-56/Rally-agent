import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RichText } from "./RichText";

vi.mock("../store", () => ({ useApp: () => ({ openTab: () => {} }) }));
const render = (text: string) => renderToStaticMarkup(createElement(RichText, { text }));

describe("conversation Markdown", () => {
  it("renders nested Markdown and GFM without rewriting bracketed prose", () => {
    const html = render("## 标题\n\n**粗体**、*斜体*、~~删除~~、`inline` 和 [T-1]\n\n1. 第一项\n   - 子项\n\n> 引用\n\n- [x] 已完成\n- [ ] 待办\n\n| 名称 | 状态 |\n| --- | --- |\n| Rally | 正常 |");
    for (const token of ["<h2>", "<strong>", "<em>", "<del>", "<code>", "[T-1]", "<ol>", "<ul>", "<blockquote>", "<table>", "<th>", "disabled=\"\"", "checked=\"\""]) expect(html).toContain(token);
  });
  it("preserves fenced code and accepts incomplete streaming blocks", () => {
    for (const ending of ["", "\n```\n"]) {
      const html = render('```ts\nconst value = "<img src=x>";\n  // **literal**' + ending);
      expect(html).toContain('<pre><code class="language-ts">');
      expect(html).toContain("&lt;img src=x&gt;");
      expect(html).toContain("  // **literal**");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<strong>");
    }
  });
  it("renders HTML as inert text and never auto-loads images", () => {
    const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/pixel" onerror="alert(2)">\n\n![示意图](https://example.com/image.png)');
    expect(html).not.toMatch(/<(script|img|iframe)/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('title="https://example.com/image.png"');
    expect(html).toContain("示意图</button>");
  });
  it("only makes credential-free absolute HTTP(S) links actionable", () => {
    const html = render('[网页](https://example.com/a?q=1) https://example.org\n\n[脚本](javascript:alert) [文件](file:///C:/secret) [相对](./local) [凭据](https://user:secret@example.com) [数据](data:text/html,test)');
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toContain('title="https://example.com/a?q=1"');
    expect(html).not.toContain("secret");
    expect(html).not.toContain("javascript:");
    for (const label of ["脚本", "文件", "相对", "凭据", "数据"]) expect(html).toContain(`<span>${label}</span>`);
  });
});
