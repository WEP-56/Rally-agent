# Rally 开发交接（2026-11-26）

入口：[文档索引](README.md) · [发布指南](发布指南.md) · [0.5.0 发布说明](发布说明-0.5.0.md) · [产品问答](superagent/00-问答记录.md) · [Prompt](Prompt/system-prompt.md)。

## 下一会话：品牌吉祥物

用户已确认本轮 Android 适配“完美”，要求提交代码、更新交接。下一项是品牌吉祥物，用户准备的案例位于本机 `example/dynamic-md3-agent-mascot/`。本轮没有开始集成，也没有创建新会话。

先阅读案例的 `src/App.tsx`、`src/components/MochiMascotSvg.tsx`、`src/types/mascot.ts`、`src/components/RealWorldPreviews.tsx` 和 `src/components/IntegrationModal.tsx`。案例是 React/SVG 吉祥物，包含弹簧、视线跟随、交互，以及 idle、thinking、searching、orchestrating、coding、replying、error、completed 八种演示状态。该目录在 Git 忽略范围内，仅本机存在，不要误认为已随提交上传。

结合现有 `src/renderer/src/components/AgentAvatar.tsx`、`PresenceCapsule.tsx`、`Workstation.tsx`、`brand.tsx` 和 `md3/components.tsx` 梳理接入位置。具体替换哪些展示位置尚未确定；不要擅自覆盖用户自定义的 Agent 头像。演示状态、日志和指标不等于 Rally 的真实能力，应映射现有状态与事件，不搬入模拟任务、虚构运行信息或新的全局配色。用户重视原型还原度、弹簧动效和温暖的个人助手气质。

## 本轮完成并获用户验收

- Android 聊天顶部改成左搜索、中央身份徽标、右设置，保证徽标真正居中。
- 新增 `appearance.ts`，复用在主界面与连接页；通过 `ConnectionBridge.setAppearance` 同步 Android 状态栏、导航栏背景及图标明暗。原生壳保存上次外观，启动页也使用对应颜色。
- 修复 Gecko 顶部玻璃：CSS 优化器会按声明顺序合并前缀，必须将标准 `backdrop-filter` 放在 `-webkit-backdrop-filter` 后面。构建产物回归检查覆盖标准属性保留。
- 禁用移动端页面双指缩放；MCP 操作栏允许换行，设置页防止横向溢出；外观页窄屏采用上下布局，大字号不再将说明文字挤成竖排。
- 用 `AccentPicker.tsx` 替代原生颜色对话框，保留预设颜色，支持 HCT 滑杆与十六进制输入，复用现有主题算法和 token。
- 聊天、设置、右侧栏外层上下铺满，去掉桌面式留白和外层圆角；输入框、卡片自身圆角保留。规则严格限定 `[data-platform="android"]`，Windows 外层布局不受影响。
- 账号状态响应为空或结构错误时保留上次有效状态并报告错误，防止聊天页崩溃。

调试期间曾临时切到本地测试服务；因其遗漏账号状态导致 `credentials.state is null`，不是 VPS 故障。已恢复用户原有 VPS 配对并停掉测试服务及 ADB 转发。用户明确要求以后直接使用已配好的 VPS 做外观验证，不再搭建或切换本地模拟服务，也不要为视觉测试发送模型消息。

## 验证与安装

- `npm run typecheck` 通过；前期完整 `npm run build`、最终 `npx electron-vite build` 通过。
- 定向执行 `node --experimental-vm-modules --test tests/attachments/client-bridge.test.mjs tests/cloud/renderer.test.mjs`，6 项通过；最后的贴边布局调整后再次运行 renderer 文件，4 项通过。
- 使用 JDK 17，`node scripts/cloud/build-android.mjs --debug --offline` 完成三个 ABI 构建、内容及签名检查。
- x86_64 调试包已覆盖安装并启动于 ADB `127.0.0.1:5555`，应用 ID `dev.rally.mobile`，VPS 配对保留。用户亲自完成视觉验收。
- 调试包在 `release/Rally-0.5.0-android-<ABI>-debug.apk`；调试签名保存在忽略的 `.artifacts/android-debug.p12`，后续覆盖安装需保留此签名，不能卸载清除配对数据。
- 本轮不提升版本、不打 tag、不发布；修复跟随下一版本。当前用户仅要求 Git 提交，未要求将本轮推送到远端。

## 已有发布与部署状态

0.5.0 已完成 MD3 界面与新图标发布。`v0.5.0` 指向 `9f0c4af`，发布检查修复为 `b1b5449`，流水线 `45781860358` 已成功。新品牌图标源为 `docs/icon.png`，由 `scripts/generate-icons.mjs` 生成各平台资源；保留透明圆角。README 已改为简短温暖风格，Linux DO 社区认可信息需保留。

VPS 已按用户要求从 0.4.1 更新到正式 0.5.0，未创建备份，原配置与业务数据保留，两个 Rally 服务及健康检查正常。实际为受限普通账号运行的 systemd 部署，并非 Docker；用户已决定暂不调整部署方式或权限。连接信息仅在私有 `.signing/` 中，不复制到文档或日志。另有与 Rally 无关的 `mistral-proxy` 启动失败，之前已告知用户，未修改。

## 保持的约定

- 当前 UI 风格以 `example/rally-md3-design` 及已迁移组件为准；功能字段按产品问答，不从演示反推。新吉祥物案例作为下一项设计依据。
- 用中文、简单易懂地沟通。视觉默认由用户验收；未明确要求时不启动浏览器、截图或 Electron 验收。本轮后半程用户已要求自己验证。
- 修改代码后跑类型检查；不跑全量 Vitest，不触发真实模型 API。只执行必要的指定文件测试。
- 用户要求时才提交，只暂存明确路径，不重置、不清理用户文件、不强推、不跳过 hook。
- 主进程与 renderer 经 `src/shared/ipc.ts` 声明通道通信；Android 原生连接能力经 `src/shared/connection.ts` 的既有桥接。
- 外部 Claude/Codex 执行器仍按需安装，用户目录中的工具与认证不随升级覆盖；不要把庞大 CLI 依赖重新打入基础包。
- Rally 内的 Agent 没有本开发会话上下文，修改提示词、工具说明或 Skill 时必须给出完整可理解的信息。
