import {
  argbFromHex,
  Blend,
  Hct,
  hexFromArgb,
  SchemeFidelity,
} from "@material/material-color-utilities";

export type ThemeMode = "light" | "dark" | "system";

export interface SeedPreset {
  id: string;
  name: string;
  hex: string;
}

export const DEFAULT_SEED_HEX = "#33658E";

export const SEED_PRESETS: SeedPreset[] = [
  { id: "mist", name: "雾霭蓝", hex: "#33658E" },
  { id: "cocoa", name: "暖砂可可", hex: "#8F6249" },
  { id: "seafoam", name: "海盐青", hex: "#0F7E7B" },
  { id: "iris", name: "鸢尾紫", hex: "#6854A4" },
  { id: "orbit", name: "星轨靛", hex: "#5263E0" },
  { id: "sage", name: "苔原松", hex: "#3B6C4E" },
];

function harmonizedSemanticRole(baseHex: string, seedArgb: number, isDark: boolean) {
  const harmonizedArgb = Blend.harmonize(argbFromHex(baseHex), seedArgb);
  const hct = Hct.fromInt(harmonizedArgb);
  const chroma = Math.max(hct.chroma, 34);
  if (isDark) {
    return {
      main: hexFromArgb(Hct.from(hct.hue, chroma, 80).toInt()),
      onMain: hexFromArgb(Hct.from(hct.hue, chroma, 20).toInt()),
      container: hexFromArgb(Hct.from(hct.hue, chroma * 0.72, 26).toInt()),
      onContainer: hexFromArgb(Hct.from(hct.hue, chroma * 0.85, 90).toInt()),
    };
  }
  return {
    main: hexFromArgb(Hct.from(hct.hue, chroma, 40).toInt()),
    onMain: hexFromArgb(Hct.from(hct.hue, chroma, 100).toInt()),
    container: hexFromArgb(Hct.from(hct.hue, chroma * 0.65, 91).toInt()),
    onContainer: hexFromArgb(Hct.from(hct.hue, chroma * 0.9, 16).toInt()),
  };
}

export function generateMd3Tokens(
  seedHex: string,
  isDark: boolean,
  contrast = 0,
): Record<string, string> {
  const safeHex = /^#[0-9a-fA-F]{6}$/.test(seedHex) ? seedHex : DEFAULT_SEED_HEX;
  const sourceHct = Hct.fromInt(argbFromHex(safeHex));
  const scheme = new SchemeFidelity(sourceHct, isDark, contrast, "2025", "phone");

  const ok = harmonizedSemanticRole("#1E8E68", scheme.sourceColorArgb, isDark);
  const warn = harmonizedSemanticRole("#C7771A", scheme.sourceColorArgb, isDark);

  return {
    "--md-sys-color-primary": hexFromArgb(scheme.primary),
    "--md-sys-color-on-primary": hexFromArgb(scheme.onPrimary),
    "--md-sys-color-primary-container": hexFromArgb(scheme.primaryContainer),
    "--md-sys-color-on-primary-container": hexFromArgb(scheme.onPrimaryContainer),
    "--md-sys-color-primary-fixed": hexFromArgb(scheme.primaryFixed),
    "--md-sys-color-primary-fixed-dim": hexFromArgb(scheme.primaryFixedDim),
    "--md-sys-color-on-primary-fixed": hexFromArgb(scheme.onPrimaryFixed),

    "--md-sys-color-secondary": hexFromArgb(scheme.secondary),
    "--md-sys-color-on-secondary": hexFromArgb(scheme.onSecondary),
    "--md-sys-color-secondary-container": hexFromArgb(scheme.secondaryContainer),
    "--md-sys-color-on-secondary-container": hexFromArgb(scheme.onSecondaryContainer),

    "--md-sys-color-tertiary": hexFromArgb(scheme.tertiary),
    "--md-sys-color-on-tertiary": hexFromArgb(scheme.onTertiary),
    "--md-sys-color-tertiary-container": hexFromArgb(scheme.tertiaryContainer),
    "--md-sys-color-on-tertiary-container": hexFromArgb(scheme.onTertiaryContainer),

    "--md-sys-color-error": hexFromArgb(scheme.error),
    "--md-sys-color-on-error": hexFromArgb(scheme.onError),
    "--md-sys-color-error-container": hexFromArgb(scheme.errorContainer),
    "--md-sys-color-on-error-container": hexFromArgb(scheme.onErrorContainer),

    "--md-sys-color-surface": hexFromArgb(scheme.surface),
    "--md-sys-color-surface-dim": hexFromArgb(scheme.surfaceDim),
    "--md-sys-color-surface-bright": hexFromArgb(scheme.surfaceBright),
    "--md-sys-color-surface-container-lowest": hexFromArgb(scheme.surfaceContainerLowest),
    "--md-sys-color-surface-container-low": hexFromArgb(scheme.surfaceContainerLow),
    "--md-sys-color-surface-container": hexFromArgb(scheme.surfaceContainer),
    "--md-sys-color-surface-container-high": hexFromArgb(scheme.surfaceContainerHigh),
    "--md-sys-color-surface-container-highest": hexFromArgb(scheme.surfaceContainerHighest),

    "--md-sys-color-on-surface": hexFromArgb(scheme.onSurface),
    "--md-sys-color-on-surface-variant": hexFromArgb(scheme.onSurfaceVariant),
    "--md-sys-color-outline": hexFromArgb(scheme.outline),
    "--md-sys-color-outline-variant": hexFromArgb(scheme.outlineVariant),

    "--md-sys-color-inverse-surface": hexFromArgb(scheme.inverseSurface),
    "--md-sys-color-inverse-on-surface": hexFromArgb(scheme.inverseOnSurface),
    "--md-sys-color-inverse-primary": hexFromArgb(scheme.inversePrimary),

    "--rally-color-ok": ok.main,
    "--rally-color-on-ok": ok.onMain,
    "--rally-color-ok-container": ok.container,
    "--rally-color-on-ok-container": ok.onContainer,

    "--rally-color-warn": warn.main,
    "--rally-color-on-warn": warn.onMain,
    "--rally-color-warn-container": warn.container,
    "--rally-color-on-warn-container": warn.onContainer,
  };
}

export function applyMd3TokensToRoot(
  seedHex: string,
  isDark: boolean,
  contrast = 0,
): Record<string, string> {
  const tokens = generateMd3Tokens(seedHex, isDark, contrast);
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
  return tokens;
}
