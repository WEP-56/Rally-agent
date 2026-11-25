# Rally 开发交接（2026-11-25）

入口：[发布指南](发布指南.md) · [0.4.1 发布说明](发布说明-0.4.1.md) · [产品问答](superagent/00-问答记录.md) · [Prompt](Prompt/system-prompt.md)。

## 本轮目标与状态

用户已授权修复外部执行器导致的安装包膨胀，并提交、推送、发布修复版。0.4.0 已正式发布；本轮准备 0.4.1，不移动旧 tag，不替换旧产物，不部署 VPS。发布流程必须完成到正式 Release，不能停在草稿。

0.4.0 的 Windows 521,834,482 字节、Linux 757,100,150 字节；主要原因是两个 ACP adapter 的生产依赖带入 Claude/Codex 原生 CLI，Linux 还同时安装 Claude glibc 与 musl 版本。0.4.1 已从根依赖移除两个 adapter 及其传递运行时，保留轻量 ACP SDK。首个本地 Windows 精简包约 250 MB，仍需核对最终 CI 产物。

外部会话从用户目录按需安装的 adapter 启动，CLI 优先复用设备现有程序。可选路径配置为 `$RALLY_CODING_AGENT_DIR/external-agents.json`；默认 adapter 目录为 `external-agents/<claude-code|codex>/node_modules/.../dist/index.js`。设置页不自动安装，错误提示引导自管理。具体字段、优先级和安装命令在 `skills/references/external-agents.md`。Windows 支持 npm shim，实际读取包的 bin 字段，兼容新版 Claude 原生安装。Linux install.sh 同步修复漏复制 skills 的问题。

自管理仍然只有一个 `skills/SKILL.md`，八个领域文件是 references，不能各自注册 Skill，不能放到 docs/Prompt。新增路径配置已写入总索引。Worker 不共享主 Agent 的完整上下文，说明必须明确目标主机、运行账号、配置路径和验证方法。

## 发布与验证

- 当前发布 tag `v0.4.0` 指向 `3a07bc9`；CI `45559067156` 完成三平台构建。`4d957ec` 修正了 shutdown 测试的 Electron app.getAppPath 替身。旧 tag 没有移动。
- 0.4.1 外部执行器定向测试 11 项通过，覆盖路径发现、npm 安装、按需原生依赖、配置错误、缺失时不安装，以及真实子进程的离线 ACP 会话。角色/Skill 相关筛选通过，Skill 格式校验通过。
- 主进程和渲染进程类型检查通过。根 `npm run typecheck` 仍只有 `packages/ai/test/fireworks-models.test.ts` 与 `anthropic-empty-thinking-signature-compat.test.ts` 两个文件的 9 个已知模型数据错误。
- 发布检查新增 lockfile 与 Windows/Linux 实际目录验证，阻止外部 adapter、SDK 运行时与原生 CLI 重新混入基础包。真实付费模型调用和界面视觉没有作为已验收项。
- 本地 `.artifacts/external-agent-smoke/` 仅用于临时安装无原生依赖的 adapter、以隔离配置验证打包后的 Electron Node 复用本机 CLI；发布后清理这个临时目录。

## 生产与未完成验收

VPS 仍运行 0.3.0；本轮没有部署授权。此前 Linux 命令退出竞态已修复并随 0.4.0 发布，GitHub CLI gh 2.105.0 也自 0.4.0 起随 Linux 包提供；不要将仓库状态当作 VPS 已升级状态。

浏览器接管点击/拖动与额外遮挡、账密回告、询问卡片自由回答已修复并随 0.4.0 发布。真实网站登录/验证码、完整设备视觉和外部执行器实际模型任务由用户验收；QQ 登录失败不能等同于账密回告丢失，若继续排查需读取新的实际日志。

## 必须保留的边界

- 界面保持现有原型风格和 token，功能字段以产品问答为准。
- 普通外链在客户端打开；Agent 浏览器在执行主机，所有 Worker 共用 profile，每任务独立窗口，上限三个。主 Agent 没有浏览器操作工具。
- 外部 Claude/Codex Worker 不接入 Rally 浏览器、MCP 或内部工具；复用目标主机自身登录，权限提升请求拒绝，不宣称主机级隔离。
- 用户目录中的外部工具、登录数据不随应用升级覆盖。只按用户所需执行器安装，复用已有 CLI 时使用 --omit=optional 避免重复下载原生程序。
- 不跑全量 vitest，不触发真实模型 API；按文件运行离线测试。只 git add 明确路径，不能 force push 或清理用户工作。
- 私有 VPS 连接信息仍只在用户指定的私有位置，不写公开文档。
