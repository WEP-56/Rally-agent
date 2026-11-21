export type CloseBehavior = "quit" | "tray";
export interface DesktopSettings {
  closeBehavior: CloseBehavior;
  trayAvailable: boolean;
  openAtLogin: boolean;
  loginItemAvailable: boolean;
}
