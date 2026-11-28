/* 预录剧本：每个剧本对应官网上的一个“真实场景”。
 * 步骤只描述“发生了什么”，引擎负责时序、门禁等待与状态更新。 */

export interface ToolSpec {
  name: string;
  target: string;
  output: string;
  ms?: number;
}

export type Step =
  | { op: "say"; text: string }
  | ({ op: "tool" } & ToolSpec)
  | { op: "ask"; question: string; options: string[] }
  | { op: "dispatch"; title: string; summary: string; cwd: string }
  | ({ op: "work" } & ToolSpec)
  | { op: "workSay"; text: string }
  | {
      op: "gate";
      action: string;
      cwd: string;
      scope: string[];
      alternative: string;
      mailBody?: string;
      run: ToolSpec;
      denied: string;
    }
  | { op: "finish"; status: "done" | "scheduled"; duration: string; text: string; deniedText?: string };

export interface Script {
  id: string;
  steps: Step[];
}

const fixTests: Script = {
  id: "fix-tests",
  steps: [
    { op: "say", text: "好，我先跑一遍测试，看看哪里红了。" },
    {
      op: "tool",
      name: "bash",
      target: "npm test",
      output: "FAIL src/utils/date.test.ts\n  ● 时区换算 › 夏令时边界\n    expected 2026-03-29T02:00  received 2026-03-29T03:00\n\nTests: 1 failed, 41 passed, 42 total",
      ms: 1400,
    },
    { op: "say", text: "有 1 个用例挂在夏令时边界上。我派一位 Worker 去修，你随时可以点开它看进展。" },
    { op: "dispatch", title: "修复夏令时边界用例", summary: "定位 date.ts → 修改 → 重跑测试", cwd: "~/code/rally-demo" },
    { op: "work", name: "read", target: "src/utils/date.ts", output: "export function toLocal(ts: number, zone: string) {\n  const offset = zoneOffset(zone, ts);\n  return new Date(ts + offset);\n}", ms: 800 },
    { op: "work", name: "edit", target: "src/utils/date.ts", output: "+ 夏令时缺失的小时：向后顺延 1 小时\n- return new Date(ts + offset);", ms: 1100 },
    { op: "work", name: "bash", target: "npm test", output: "Tests: 42 passed, 42 total", ms: 1200 },
    { op: "workSay", text: "42 个用例全部通过，修改已经提交到本地分支 fix/dst-boundary。推送到远端属于对外操作，我先请你确认。" },
    {
      op: "gate",
      action: "推送分支 fix/dst-boundary 到 origin",
      cwd: "~/code/rally-demo",
      scope: ["远程仓库 origin（对外可见）", "新增 1 个提交，3 行改动"],
      alternative: "只保留本地提交，稍后手动推送",
      run: { name: "git", target: "git push origin fix/dst-boundary", output: "To github.com:you/rally-demo.git\n   3f2a1c0..9b7e4d1  fix/dst-boundary -> fix/dst-boundary", ms: 1000 },
      denied: "好的，已取消推送，提交保留在本地分支里。",
    },
    {
      op: "finish",
      status: "done",
      duration: "38s",
      text: "修好啦 ✨ 42 个用例全绿，推送也按你的允许完成了。夏令时边界的修复在 fix/dst-boundary 上，你可以直接开 PR。",
      deniedText: "修好啦 ✨ 42 个用例全绿。推送还在等你点头，提交保留在本地。",
    },
  ],
};

const weeklyReport: Script = {
  id: "weekly-report",
  steps: [
    { op: "say", text: "好！我先把本周的 issue 拉下来看看。" },
    { op: "tool", name: "github", target: 'gh issue list --search "updated:>2026-11-21"', output: "#412 修复 Android 断线重连     closed\n#418 定时任务跨午夜窗口       closed\n#421 连接器工具权限 UI        open\n…… 共 14 条", ms: 1300 },
    { op: "dispatch", title: "生成本周周报", summary: "汇总 14 条 issue → 草稿 → 发送邮件", cwd: "~/Rally/周报" },
    { op: "work", name: "write", target: "~/Rally/周报/2026-W48.md", output: "已写入 812 字：已完成 / 进行中 / 下周计划 三段", ms: 1100 },
    { op: "workSay", text: "周报草稿写好了。发邮件是不可逆的，我先把正文给你看一眼。" },
    {
      op: "gate",
      action: "发送周报邮件到 you@qq.com",
      cwd: "~/Rally/周报",
      scope: ["收件人 you@qq.com", "发送后无法撤回"],
      alternative: "先保存为草稿，你确认后再发",
      mailBody: "本周关闭 9 条 issue，新开 5 条。\n亮点：Android 断线重连更稳；定时任务支持跨午夜窗口。\n下周：连接器权限 UI 收尾。",
      run: { name: "qqmail_send", target: "you@qq.com · 本周周报", output: "发送成功 · 已保存审计记录", ms: 1000 },
      denied: "好的，周报先留在草稿里，没有发出去。",
    },
    {
      op: "finish",
      status: "done",
      duration: "21s",
      text: "周报已经发出去啦 📮 草稿也留在了 ~/Rally/周报/ 里。",
      deniedText: "周报草稿已经准备好，等你点头再发。",
    },
  ],
};

const repoArchitecture: Script = {
  id: "repo-architecture",
  steps: [
    { op: "say", text: "好呀！你想看哪个分支的架构？" },
    { op: "ask", question: "要分析哪个分支？", options: ["main（推荐）", "当前工作分支"] },
    { op: "say", text: "收到，就看 {answer}。我派一位 Worker 去读源码，你可以随时点开看它的进展。" },
    { op: "dispatch", title: "分析 Rally 的架构", summary: "读取 packages/ 与 src/main/ → 画出分层", cwd: "WEP-56/Rally-agent" },
    { op: "work", name: "github", target: "gh repo view WEP-56/Rally-agent", output: "WEP-56/Rally-agent · TypeScript · MIT", ms: 900 },
    { op: "work", name: "ls", target: "src/main/", output: "supervisor/  connector-tools.ts  feishu-connection.ts  mcp-store.ts …… 共 58 项", ms: 800 },
    { op: "work", name: "grep", target: "registerTool|defineTool", output: "17 处匹配，分布在 9 个文件", ms: 1000 },
    { op: "workSay", text: "主进程的 Supervisor 之下分出调度、Worker、权限三块；Agent 运行时源自开源项目 Pi。分层图整理好了。" },
    {
      op: "finish",
      status: "done",
      duration: "16s",
      text: "架构摘要整理好了：设备层 → Supervisor → Agent 运行时 → 能力层。官网下面的「架构一览」就是按同一份分层做的 ✓",
    },
  ],
};

const priceWatch: Script = {
  id: "price-watch",
  steps: [
    { op: "say", text: "没问题！我先看看现在的价格，再给你排个班～" },
    { op: "tool", name: "browser", target: "shop.example.com / gpu-rtx5070", output: "当前价格 ¥4,899 · 有货", ms: 1200 },
    { op: "dispatch", title: "盯住显卡价格", summary: "每 2 小时 · 9:00–21:00 · 低于 ¥4599 飞书通知", cwd: "~/Rally/盯价" },
    { op: "work", name: "schedule_create", target: "每 2 小时 · 9:00–21:00 · Asia/Shanghai", output: "计划已保存，下次运行 14:00", ms: 1000 },
    {
      op: "finish",
      status: "scheduled",
      duration: "定时",
      text: "安排好啦！今天 14:00 起每两小时看一眼价格，一旦低于 ¥4599 就用飞书喊你 📣 任务已经放进「定时」里，随时可以改。",
    },
  ],
};

const tidyDownloads: Script = {
  id: "tidy-downloads",
  steps: [
    { op: "say", text: "收到！我只移动、不删除，随时跟你汇报～" },
    { op: "tool", name: "ls", target: "~/Downloads", output: "共 47 个文件：21 张图片、12 份文档、9 个安装包、5 个压缩包", ms: 900 },
    { op: "dispatch", title: "整理下载文件夹", summary: "按类型归档 · 只移动不删除", cwd: "~/Downloads" },
    { op: "work", name: "mkdir", target: "文档 / 图片 / 安装包 / 压缩包 / 其它", output: "5 个分类目录已建好", ms: 700 },
    { op: "work", name: "move", target: "按扩展名归类 · 重名自动加序号", output: "47/47 移动完成 · 0 冲突 · 0 失败", ms: 1500 },
    {
      op: "finish",
      status: "done",
      duration: "18s",
      text: "收拾好啦！✨ 图片 21 张 → 图片/，文档 12 份 → 文档/ …… invoice(1).pdf 和旧文件重名，我改成了 invoice-2.pdf。",
    },
  ],
};

const generic: Script = {
  id: "generic",
  steps: [
    { op: "say", text: "收到！这里是官网上的预录演示，只能演给你看。装上 Rally 之后，我会真的去做这件事——动手前先问你。" },
  ],
};

/** 主对话里的关键词路由。顺序很重要：周报要先于“整理”。 */
export function matchScript(text: string): Script {
  if (/测试|修复|失败/.test(text)) return fixTests;
  if (/周报|issue/i.test(text)) return weeklyReport;
  if (/架构|仓库|github/i.test(text)) return repoArchitecture;
  if (/价格|盯|降价/.test(text)) return priceWatch;
  if (/下载|整理|文件/.test(text)) return tidyDownloads;
  return generic;
}

/** 欢迎页的建议，与 Rally 客户端欢迎页的文案保持一致风格 */
export const SUGGESTIONS = [
  "分析一个 GitHub 仓库的架构",
  "整理本周 issue 生成周报",
  "运行测试并修复失败用例",
  "盯住显卡价格，降价就通知我",
];
