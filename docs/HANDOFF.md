# Rally 开发交接（2026-11-26）

入口：[文档索引](README.md) · [发布指南](发布指南.md) · [0.5.0 发布说明](发布说明-0.5.0.md) · [产品问答](superagent/00-问答记录.md) · [Prompt](Prompt/system-prompt.md)。

## 品牌吉祥物接入（2026-11-26）

用户提供的设计案例位于本机 `example/dynamic-md3-agent-mascot/`，原目录处于 Git 忽略范围。核心骨骼化 SVG 与性能探测已移入 `src/renderer/src/mascot/`，移植时去掉演示用场景/指标类型，只保留实际可用的状态与弹簧物理。

默认头像由 `IdentityState.avatar === null` 决定，与名称、性格和工作方式无关。默认显示 Mochi；用户选择 PNG 头像后沿用原头像。聊天顶部和工位顶部显示动态吉祥物，小尺寸身份头像显示静态紧凑图，避免每条消息都启动独立动画。聊天活动只从主 Agent 的 `ChatHeaderState` 读取，不混入 worker 任务状态；活动映射到待机、思考、查询、任务编排、工具调用、回复和整理。主 Agent 的完成/错误结果短暂驱动庆祝/错误姿态，中止不标记为完成。设置-外观新增“减少动效”；系统减弱动态效果也会停用连续吉祥物动画。移动/低性能环境降帧、跳过滤镜和装饰动画，隐藏或滚出视口时暂停循环。

验证：`npm run typecheck`、`node node_modules/vitest/vitest.mjs --run src/renderer/src/mascot/state.test.ts src/renderer/src/components/AssistantContent.test.ts`、`npx electron-vite build` 均通过。用户已确认界面现在能看到吉祥物。随后按反馈移除吉祥物状态解析对 worker 任务列表的依赖，只由主 Agent `ChatHeaderState` 驱动态；新增 `state.test.ts` 覆盖查询、派发、回复、完成和中止。首次引导第 2 步的身份设置上方新增动态精灵与“使用默认头像，我就能一直陪着你哦”气泡，仅当前步骤运行；用户已确认效果。聊天助手消息气泡已移除重复头像并收回左侧缩进，顶部身份徽标和空状态欢迎头像保留。

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
