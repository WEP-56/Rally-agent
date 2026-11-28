import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyMd3TokensToRoot } from "./rally/theme";

/** Rally 客户端内置的主题色预设（src/renderer/src/md3/theme.ts） */
export const SEED_PRESETS = [
  { id: "mist", name: "雾霭蓝", hex: "#33658E" },
  { id: "cocoa", name: "暖砂可可", hex: "#8F6249" },
  { id: "seafoam", name: "海盐青", hex: "#0F7E7B" },
  { id: "iris", name: "鸢尾紫", hex: "#6854A4" },
  { id: "orbit", name: "星轨靛", hex: "#5263E0" },
  { id: "sage", name: "苔原松", hex: "#3B6C4E" },
] as const;

interface ThemeCtx {
  dark: boolean;
  toggleDark: () => void;
  seed: string;
  setSeed: (hex: string) => void;
  seedName: string;
}

const Ctx = createContext<ThemeCtx>({
  dark: false,
  toggleDark: () => {},
  seed: SEED_PRESETS[0].hex,
  setSeed: () => {},
  seedName: SEED_PRESETS[0].name,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("rally-site-dark");
      if (saved !== null) return saved === "1";
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  const [seed, setSeedState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("rally-site-seed");
      if (saved && /^#[0-9a-fA-F]{6}$/.test(saved)) return saved;
    } catch {}
    return SEED_PRESETS[0].hex;
  });

  useEffect(() => {
    applyMd3TokensToRoot(seed, dark);
    try {
      localStorage.setItem("rally-site-dark", dark ? "1" : "0");
      localStorage.setItem("rally-site-seed", seed);
    } catch {}
  }, [seed, dark]);

  const value = useMemo<ThemeCtx>(
    () => ({
      dark,
      toggleDark: () => setDark((d) => !d),
      seed,
      setSeed: setSeedState,
      seedName: SEED_PRESETS.find((p) => p.hex === seed)?.name ?? "自定义",
    }),
    [dark, seed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
