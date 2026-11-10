import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";

/** Runs only in the network worker thread; scripts and subresource fetching stay disabled. */
export function pageMarkdown(html: string, url: string): { title: string; text: string } {
	const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
	try {
		const document = dom.window.document;
		if (document.getElementsByTagName("*").length > 50000) throw new Error("PAGE_TOO_COMPLEX: HTML 超过 50000 个元素");
		const title = document.title.trim();
		for (const node of document.querySelectorAll("script,style,noscript,iframe,object,embed,svg,canvas,form,nav,footer,[hidden],[aria-hidden='true']")) node.remove();
		for (const element of document.querySelectorAll("[href],[src]")) {
			for (const attr of ["href", "src"]) {
				const value = element.getAttribute(attr); if (!value) continue;
				try {
					const target = new URL(value, document.baseURI);
					if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) element.removeAttribute(attr);
					else element.setAttribute(attr, target.href);
				} catch { element.removeAttribute(attr); }
			}
		}
		const article = new Readability(document.cloneNode(true) as Document, { maxElemsToParse: 50000, disableJSONLD: true, charThreshold: 100 }).parse();
		const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
		converter.addRule("table", {
			filter: "table",
			replacement: (_content, node) => {
				const rows = Array.from((node as HTMLTableElement).rows).map(row => Array.from(row.cells).map(cell => converter.turndown(cell.innerHTML).replace(/\n+/g, " ").replace(/\|/g, "\\|")));
				if (!rows.length) return "";
				const width = Math.max(...rows.map(row => row.length));
				const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
				return `\n\n${[line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
			},
		});
		return { title: article?.title?.trim() || title, text: converter.turndown(article?.content || document.querySelector("main,article")?.innerHTML || document.body.innerHTML).trim() };
	} finally { dom.window.close(); }
}
