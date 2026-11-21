import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CloseBehavior } from "../shared/desktop.ts";

/** Client-local settings survive local/cloud profile changes and never sync to the VPS. */
export class DesktopPreferences {
  private behavior: CloseBehavior = "quit";
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
    try {
      if (existsSync(file)) this.behavior = validate(JSON.parse(readFileSync(file, "utf8")).closeBehavior);
    } catch (error) { console.error("Desktop preferences unavailable; close will quit", error); }
  }
  get closeBehavior(): CloseBehavior { return this.behavior; }
  update(value: unknown): CloseBehavior {
    const behavior = validate(value);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ closeBehavior: behavior }), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    return this.behavior = behavior;
  }
}
function validate(value: unknown): CloseBehavior {
  if (value !== "quit" && value !== "tray") throw Error("无效的关闭行为");
  return value;
}
