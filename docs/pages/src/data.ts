import { version } from "../../../package.json";

export const REPO = "https://github.com/WEP-56/Rally-agent";
export const RELEASES = "https://github.com/WEP-56/Rally-agent/releases";
export const ISSUES = "https://github.com/WEP-56/Rally-agent/issues";
export const LINUXDO = "https://linux.do/";
export const VERSION = `v${version}`;

export const TICKER_ITEMS = [
  "浏览网页", "整理文件", "写代码", "定时任务", "长期记忆", "Worker 协作",
  "飞书", "QQ 机器人", "QQ 邮箱", "SSH", "MCP 服务", "Skills 技能包",
  "图像生成", "网络搜索", "密码本", "多设备共享",
];

/* ─────────────────────────── 连接器（“插头”） ─────────────────────────── */

export interface Connector {
  id: string;
  name: string;
  /** 品牌标识：客户端里 ConnectionsView 的 mark 字段 */
  mark: string;
  color: string;
  desc: string;
  /** 初始是否已连接 */
  plugged: boolean;
  /** 带权限档的工具名（与 src/main/connector-tools.ts 的名称一致） */
  tier?: string;
}

export const CONNECTORS: Connector[] = [
  { id: "feishu", name: "飞书", mark: "飞", color: "#3370ff", desc: "机器人单聊 · 云文档 · 多维表格", plugged: true },
  { id: "qqbot", name: "QQ 机器人", mark: "QQ", color: "#3799ff", desc: "官方机器人私聊直达主对话", plugged: false },
  { id: "qqmail", name: "QQ 邮箱", mark: "✉", color: "#8871e3", desc: "检索 · 读取 · 发送", plugged: true, tier: "qqmail_send" },
  { id: "github", name: "GitHub CLI", mark: "gh", color: "#24292f", desc: "复用服务账号的 gh 登录态", plugged: true },
  { id: "ssh", name: "SSH", mark: ">_", color: "#22a06b", desc: "远程主机执行与读取", plugged: false },
  { id: "mcp", name: "MCP 服务", mark: "MCP", color: "#b7790c", desc: "接入你自己配置的任意 MCP 服务", plugged: true },
  { id: "acp", name: "Claude Code / Codex", mark: "AI", color: "#c4553f", desc: "ACP 连接层，复用已有 CLI 与登录", plugged: false },
  { id: "media", name: "生图 · 搜索", mark: "✦", color: "#0f7e7b", desc: "图像生成与网络搜索提供商", plugged: true },
];

/* ─────────────────────────── 架构 ─────────────────────────── */

export interface ArchNode {
  id: string;
  name: string;
  tag: string;
  desc: string;
  paths: string[];
}

export interface ArchLayer {
  id: string;
  name: string;
  blurb: string;
  nodes: ArchNode[];
}

export const ARCH_LAYERS: ArchLayer[] = [
  {
    id: "devices",
    name: "你的设备",
    blurb: "同一套界面，三种住法。客户端负责陪伴，服务器负责 24/7 待命。",
    nodes: [
      { id: "win", name: "Windows 桌面", tag: "Electron", desc: "安装 *-setup.exe 即可在本机运行全部能力，也可以连上自己的 Linux 服务器，把长任务留在云端。", paths: ["electron-builder.yml", "src/main/index.ts"] },
      { id: "android", name: "Android 8+", tag: "APK", desc: "手机装对应架构的 APK，连接自己的服务器，在路上也能给 Rally 派活、看进度。", paths: ["android/", "scripts/cloud/build-android.mjs"] },
      { id: "server", name: "Linux 服务器", tag: "systemd", desc: "rally-runtime 与 rally-control 双服务常驻，控制台默认 127.0.0.1:4711，为每台设备签发一次性接入密钥。", paths: ["deploy/linux/", "src/console/"] },
    ],
  },
  {
    id: "supervisor",
    name: "主进程 · Supervisor",
    blurb: "Rally 的大管家：派发任务、看住时间、守住权限。",
    nodes: [
      { id: "scheduler", name: "定时调度器", tag: "Schedules", desc: "支持单次、间隔、每日，加运行时段、星期和 IANA 时区；跨午夜、夏令时、漏跑合并都算得清。", paths: ["src/main/supervisor/schedule-timing.ts", "src/main/supervisor/schedules.ts"] },
      { id: "workers", name: "Worker 派发", tag: "Workers", desc: "任务多了就叫上几位 Worker 一起搭把手。背景冻结、闲置暂停、中断后可接续，互不打架。", paths: ["src/main/role-worker-store.ts", "src/main/supervisor/services.ts"] },
      { id: "approval", name: "权限与审批", tag: "三档风险", desc: "reversible 直接执行，external 执行并留审计，irreversible 进入审批流程——动手之前先问你。", paths: ["src/main/connector-tools.ts", "src/main/project-trust.ts"] },
      { id: "memory", name: "记忆 & 密码本", tag: "Memory / Vault", desc: "记住你的偏好与约定，下次接着聊；账号密钥加密存放，跨场景取用。", paths: ["src/main/memory-store.ts", "src/main/credential-vault.ts"] },
    ],
  },
  {
    id: "runtime",
    name: "Agent 运行时 · 源自 Pi",
    blurb: "packages/ 里是 Pi 的源码，Rally 在它之上长出「个人助手」的样子。",
    nodes: [
      { id: "mainagent", name: "主 Agent", tag: "常驻对话", desc: "陪你聊想法、接住需求，决定自己动手还是派发 Worker；上下文激进压缩，一个会话无限畅聊。", paths: ["packages/agent/", "packages/coding-agent/"] },
      { id: "models", name: "模型服务", tag: "你来选", desc: "模型与提供商完全由你配置，请求直发你的服务；Rally 不代管任何密钥之外的东西。", paths: ["packages/ai/", "src/main/model-store.ts"] },
      { id: "skills", name: "Skills & MCP", tag: "扩展", desc: "用技能包和 MCP 服务添点宝贝，内置自我管理 Skill 还能复用 Claude Code / Codex 等外部 Agent。", paths: ["skills/", "src/main/mcp-store.ts", "src/main/skill-store.ts"] },
    ],
  },
  {
    id: "capabilities",
    name: "能力层",
    blurb: "真正动手的部分——看得到过程，也看得到结果。",
    nodes: [
      { id: "browser", name: "浏览器操作", tag: "Playwright", desc: "打开网页、读正文、盯价格、填表单，截图和过程随时可查。", paths: ["src/main/agent-browser/"] },
      { id: "files", name: "文件 & 终端", tag: "node-pty", desc: "整理目录、跑脚本、看实时终端输出，工作区信任分级管理。", paths: ["src/main/terminal-host.ts", "src/main/workspace-store.ts"] },
      { id: "connectors", name: "连接器", tag: "IM / Mail / SSH", desc: "飞书、QQ 机器人、QQ 邮箱、SSH、GitHub CLI——人不在电脑前，消息也能进来、结果也能出去。", paths: ["src/main/feishu-connection.ts", "src/main/qqmail-connection.ts", "src/main/ssh-connection.ts"] },
      { id: "extras", name: "生图 & 搜索", tag: "Providers", desc: "接入图像生成与网络搜索提供商，工具箱再大一圈。", paths: ["docs/其它提供商.md"] },
    ],
  },
];

/* ─────────────────────────── 部署 ─────────────────────────── */

export interface DeployPlatform {
  id: string;
  name: string;
  icon: "windows" | "android" | "server";
  headline: string;
  steps: { title: string; desc: string }[];
  code?: string[];
}

export const DEPLOY_PLATFORMS: DeployPlatform[] = [
  {
    id: "windows",
    name: "Windows",
    icon: "windows",
    headline: "下载即用，本机就是一个完整的 Rally",
    steps: [
      { title: "下载安装包", desc: "从 Releases 下载 *-setup.exe，一路下一步装好。" },
      { title: "选择运行方式", desc: "在本机运行全部能力，或连接自己的 Linux 服务器。" },
      { title: "配置模型 & 起名字", desc: "填上自己的模型服务，给它起个名字，选个性格。" },
    ],
  },
  {
    id: "android",
    name: "Android 8+",
    icon: "android",
    headline: "装在口袋里，随时派活",
    steps: [
      { title: "安装 APK", desc: "按手机架构下载对应 APK 安装。" },
      { title: "连接服务器", desc: "填入服务器地址和这台手机的一次性接入密钥。" },
      { title: "共享同一个 Rally", desc: "和电脑端共享记忆、任务与定时计划。" },
    ],
  },
  {
    id: "server",
    name: "Linux 服务器",
    icon: "server",
    headline: "让 Rally 真正 24/7 在线",
    steps: [
      { title: "校验并解包", desc: "下载 rally-server-X.Y.Z-linux-x64.tar.gz 与 SHA256SUMS。" },
      { title: "运行安装器", desc: "安装到 /opt/rally，注册 rally-runtime 与 rally-control 服务。" },
      { title: "签发接入密钥", desc: "用管理密钥登录控制台，为每台设备生成一次性密钥。" },
    ],
    code: [
      "# 从 Releases 下载同版本服务端包",
      "sha256sum --ignore-missing -c SHA256SUMS",
      `tar -xzf rally-server-${version}-linux-x64.tar.gz`,
      `cd rally-server-${version} && sudo bash install.sh`,
      "",
      "sudo systemctl status rally-runtime rally-control",
      "sudo cat /etc/rally/admin.key   # 管理密钥，用于登录控制台",
    ],
  },
];

export const ONBOARDING = [
  { step: "下载安装", desc: "Releases 里挑你的平台" },
  { step: "选择运行方式", desc: "本机 or 连接服务器" },
  { step: "配置模型服务", desc: "用你自己的 API" },
  { step: "给它起个名字", desc: "名字、头像、性格都随你" },
  { step: "开始相处", desc: "把第一件琐事交给它" },
];
