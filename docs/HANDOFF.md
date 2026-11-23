# Rally 开发交接（2026-11-23）

入口：[实施 TODO](开发实施TODO.md) · [浏览器方案及验收清单](PiBot浏览器调研与Rally落地方案.md) · [产品问答](superagent/00-问答记录.md) · [Prompt](Prompt/system-prompt.md)。

## 本轮结果

`v0.3.0` 已正式发布并部署到 VPS。应用 tag 指向 `70e031b`，发布 Actions `45184855341` 全部成功；前两轮失败仅涉及旧测试替身和图标测试路径，修复测试/工作流后从同一 tag 构建，未移动 tag。用户要求先发布再测试：密码本、浏览器真实网站和界面由用户在 Release 版验收，后续按反馈补验证和修复。

VPS 用正式 Linux Release 包升级到 `0.3.0`，未创建旧版或业务数据备份。两个 systemd 服务、健康检查、运行时版本、账号/浏览器状态接口均正常；随包 Chromium 用 `rally-runtime` 服务账号启动并取得 AI 快照。保留原有业务数据与密钥，清理了 0.1.0/0.2.0 旧目录、下载/解包临时目录及 apt 缓存，最后可用 **4583 MiB（85% 使用）**。SSH 信息仍仅保存在用户指定私有位置。

发布前补齐：凭据重复提交只保存一次、24 小时及关联任务/run 过期、密码显隐、账号修改、清除共享登录态入口；页面脱敏比较留在宿主，不将账号库秘密传入网页；接管画面只允许当前控制设备读取。展开视图 500 ms 拉取一次，帧合并在途请求；接管输入支持拖动轨迹和键盘组合键。最新账号/隐私/发布清单 5 项、生产 router 账号专项、附件/连接界面 8 项、桌面 9 项、退出清理专项及主进程/渲染进程类型检查已通过；新增交互的完整验证跟随 Release 体验继续。

- 普通外链：Windows 本地/云端模式都走客户端 WebContentsView；Android 显式调用默认浏览器。不会启动服务器浏览器。
- 账密：router 只有 `credential_request`，消息流申请卡片打开私密表单；`WebsiteAccounts` 经既有 CredentialVault 保存 txt 密文。元数据回告可在重启补发；启用账号供同源 Worker 复用，设置支持修改/停用/删除。单独清除登录态需先结束所有浏览器任务。
- Worker：`browser_open/snapshot/screenshot/navigate/action/login/file`，router 没有这些工具。所有任务共用一个 persistent Chromium profile，每任务独立原生窗口，上限 3，超出排队。弹出页归所属任务，下载不能串任务，上传只接受任务可见资源。
- 控制权：默认 Agent；接管先失效旧 epoch，等待在途动作真正结束。接管期间 Worker 等待，交还后旧动作不重放，必须重新观察。关闭视图、后台或断线后保持等待；15 秒无心跳失去控制。设备吊销通知运行时并关闭该设备在途网关响应。
- UI：主对话浏览器卡片按创建时间插入消息流，任务详情也可查看。缩略图每 3 秒按可见性刷新，敏感输入/人工接管暂停；Windows 右侧面板与 Android 移动侧栏全屏查看。默认仅观看，接管后可点选、中文输入、按键、滚动、切换标签和交还。历史仅保存窗口元数据，不保存画面。
- 账号与输出：宿主校验精确 origin、主文档及密码输入目标；快照过滤已知私密值，画面遮蔽输入和账号回显（含 iframe），Playwright 诊断不进模型日志。Worker 截图不自动发布成附件；客户端帧、控制输入和账密提交不进事件/cache/审计正文。上传与不可逆动作沿用既有 gate，批准后核对目标/表单内容哈希。
- 运行与清理：浏览器宿主接 ProcessRegistry，重启先清遗留进程。任务结束清所属标签、队列及临时上传下载；启动清宿主专用 `browser-files/`。浏览器崩溃后旧窗口失效，下一次显式打开可重新启动，不自动恢复旧操作。
- 打包：Playwright 精确固定 `1.65.1`；Windows dist 准备并携带 Headless Shell；Linux 包携带对应二进制，install.sh 安装系统库。profile 不进安装器自动备份。步骤见[发布指南](发布指南.md)和 [Linux README](../deploy/linux/README.md)。

## 已实际执行的验证

- Windows Chromium：`tests/agent-browser/runtime.test.mjs`，持久 profile、AI snapshot/getByRef、Screencast、中文输入、Cookie 共享与重启。
- `service.test.mjs`：3 个不同原生窗口/第 4 个排队、排队取消、接管等待初始/后续导航、过期输入、断线等待、关闭唤醒、账号启停/错 origin、跨窗口脱敏及敏感画面暂停。
- `managed.test.mjs`：持久进程登记、真正启动/关闭、崩溃后的旧窗口拒绝与显式重开。
- `files-and-gates.test.mjs`：拒绝不点击、批准期间表单改变不执行、上传原文件名/内容、下载资源归属、跨任务标签/下载拒绝、任务清临时文件。
- `cloud.test.mjs`：真实网关和两台设备观看/竞争/输入/吊销，帧不进入 CloudMirror；云端原有 server 协议专项通过。
- `rally-website-accounts.test.ts` 与 `rally-agent-browser.test.ts`：faux provider 走生产 router/Worker，主无浏览器工具，网站收到正确账密，模型上下文、事件、主会话、任务 jsonl 无唯一测试明文。普通浏览器/IPC 生命周期与账号专项合计 24 项通过；Worker 新专项单独通过。
- Linux Ubuntu 22.04 x64：非 root 用户、独立临时 npm/浏览器/共享库目录，runtime、service、managed 三类实测通过。未安装系统库、未改变现有服务。所有 `/tmp/rally-browser-*` 已清理；最后检查可用空间 **4206 MiB（86% 使用）**。
- Windows `electron-vite build`、server 源码构建、renderer 云端 4 项通过；临时 `electron-builder --win --dir` 成功，`packaged.test.mjs` 使用打包后的 Rally.exe/ASAR/随包 Chromium 实际启动成功。
- Android 使用仓库 `.artifacts/gradle-home` 缓存执行 `compileDebugJavaWithJavac --offline --no-daemon` 成功。SDK 路径仍有既有 location warning，Java 有 deprecated API 提示；无编译错误。没有重新出正式 APK。
- `npm run typecheck` 执行后只剩仓库已知 `packages/ai/test/fireworks-models.test.ts` 与 `anthropic-empty-thinking-signature-compat.test.ts` 模型数据错误；`tsconfig.node.json`、`tsconfig.web.json` 分别通过。

## 下一步验收与边界

1. 用户实际检查 Windows/Android 卡片视觉、点击/中文输入、滚动、遮挡、焦点与真实网站登录/发布/验证码；开发侧未启动截图或 Electron 视觉验收。
2. `v0.3.0` 发布、正式 Linux tar 包及 VPS systemd 升级已完成。后续补拖动/组合键、清除登录态、跨源 iframe/重定向拒绝等专项，以及持续下载的磁盘配额、长时间帧流与多账号选择体验核对；不要把未执行的测试记为通过。
3. 账密保密覆盖专用接口和已知值过滤；Worker 仍有同用户 shell/文件能力，不构成 OS 凭据隔离。网页任意画布/变形编码输出不是已证明的安全隔离边界。
4. 用户确认本轮功能后删除施工方案，稳定规则留在 Prompt、问答和部署文档；同步文档索引。
5. 本机临时产物清理被工具自动审批拒绝（`blocked by policy`，未提供具体原因），批量与明确路径清理都未执行。待清理：`.artifacts/browser-package/`、`build/agent-browser/`、`.signing/ssh-tools/`、`.signing/rally-remote.py`、`.signing/browser-linux-test.tar.gz`，以及本轮失败测试目录 `C:/Users/14844/AppData/Local/Temp/rally-browser-cloud-T5T9SN`。仅删除这些本轮产物，保留原有凭据。VPS 临时目录已经全部清理，这个阻碍只涉及本机。

## 必须保留的决定

- 界面风格和 token 保持现有原型；功能字段以问答记录为准。
- 用户浏览器与 Agent profile 独立；所有 Worker 共用 Agent 登录态，不能按 Worker 隔离或启动多个进程争抢 profile。
- router 只有轻量账密申请，无浏览器控制/观察工具；自动缩略图不发送 router。
- 对外发布等沿用任务授权和 gate，不按每个任务重复申请已启用账号。
- 现有教练/记忆/中继已获用户确认，不重开旧验收；原 Android 附件问题已解决。
- 私有 VPS 连接信息只在用户指定的私有位置使用，不写公开文档。Linux 系统盘小，测试使用独立临时目录，结束即清理并核对空间。
- 本轮提交、推送、`v0.3.0` Release 与 VPS 升级均已完成。应用 tag 为 `70e031b`；测试/工作流修复为 `7afcf9c`、`57e7889`，之后的文档提交仅记录结果。后续应用改动不移动这个已发布 tag。
