import { argbFromHex, Hct, hexFromArgb, SchemeFidelity } from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEED_HEX, generateMd3Tokens, SEED_PRESETS } from "./theme";

describe("MD3 theme", () => {
  it("uses the error foreground role in every preset and both modes", () => {
    for (const preset of SEED_PRESETS) {
      for (const dark of [false, true]) {
        const scheme = new SchemeFidelity(Hct.fromInt(argbFromHex(preset.hex)), dark, 0, "2025", "phone");
        const tokens = generateMd3Tokens(preset.hex, dark);
        expect(tokens["--md-sys-color-on-error-container"]).toBe(hexFromArgb(scheme.onErrorContainer));
        expect(Object.values(tokens).every(value => /^#[0-9a-f]{6}$/i.test(value))).toBe(true);
      }
    }
  });
  it("falls back safely for an invalid stored seed", () => {
    expect(generateMd3Tokens("invalid", false)).toEqual(generateMd3Tokens(DEFAULT_SEED_HEX, false));
  });
});
