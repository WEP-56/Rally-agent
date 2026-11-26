import { useEffect, useState } from "react";
import { bridge } from "./connection";
import { applyMd3TokensToRoot } from "./md3/theme";
import type { Config } from "./store";

/** Keep the page and the Android window on the same resolved theme. */
export function useAppearance(config: Pick<Config, "theme" | "accent" | "fontSize">) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    const changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query?.addEventListener("change", changed);
    return () => query?.removeEventListener("change", changed);
  }, []);
  const dark = config.theme === "dark" || (config.theme === "system" && systemDark);
  useEffect(() => {
    const tokens = applyMd3TokensToRoot(config.accent, dark);
    void bridge?.setAppearance?.(dark, tokens["--md-sys-color-surface"]).catch(error => console.error("同步系统栏主题失败", error));
  }, [dark, config.accent]);
  useEffect(() => {
    document.documentElement.style.fontSize = { sm: "14px", md: "15px", lg: "16.5px" }[config.fontSize];
  }, [config.fontSize]);
  return dark;
}
