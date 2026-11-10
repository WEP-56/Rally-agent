# Rally

基于 Pi 二次开发的 Windows 桌面 AI Agent（Electron + React）。一个主 agent 负责对话和派发，多个任务 agent 在工位上并行干活。

## 当前阶段

2026-11-10：用户已完成当前实现的阶段性测试，项目进入阶段性成果提交与开源发布。已实现主会话、双模型配置、任务编排、MCP/Skills、持久恢复及原生工作台，本轮实测反馈已修复；剩余 TODO 如实保留，不继续自动扩项。实施与验证记录见 [开发实施 TODO](docs/开发实施TODO.md)，设计以 [问答记录](docs/superagent/00-问答记录.md) 为准。

- 对话和任务已接主进程、Pi SDK 与持久事件日志；Rally 主/worker 角色提示词已显式加载，主会话声明只读工具和 8 个任务工具。
- 设置 → 供应商分别选择主 agent 与任务 agent 模型、思考档位，配置保存在 `~/.rally/agent/rally-models.json`；worker 启动与续接使用当前任务模型。
- 全局“需要批准／自动批准”持久化；待批准卡在主对话，右栏展示任务记录。已结束任务支持归档/恢复，续接和追加指令按时间展示原话及投递状态。基本派发、依赖/名额、取消、续接、worker 汇报与主会话唤醒有离线集成回归。
- 用户回答、追加与续接优先，可在普通并发上限外借用一个名额；系统唤醒与新派发不借用。worker 连续 10 分钟无事件先中止并在原会话重试一次，再次超时记为 stalled/failed 并唤醒主 agent；后台作业运行时暂停计时，前台命令输出刷新计时，常驻服务不豁免 worker。
- “整理上下文”先确认，执行期间显示模态遮罩；成功后可选择屏蔽旧会话并随时恢复显示，历史和原话 ID 保留。每次模型调用重建任务/问题/内门状态；chat_search 可查找压缩前原话并按 ID 全文取回。事件日志按 20 MiB 轮转并跨段恢复；TaskStore 定期快照并在校验失败时回退重放。主会话在已有压缩摘要且文件达 20 MiB 或本段新增 10 次压缩后轮转，保留当前上下文并指向前段。
- 状态目录在恢复前取得跨进程独占锁，退出等会话、已受理设置操作和快照收尾后释放；锁冲突会明确拒绝启动。主/worker Git、grep/find、worker shell、服务与 MCP stdio 已接 PID＋创建时间登记、启动孤儿清理与取消 5 秒升级强杀，清理失败保留登记和锁。MCP env/header/OAuth clientSecret 取值命令及搜索工具准备也在登记宿主内运行；OAuth 取值异步可取消，正常关闭等待已发刷新保存令牌。应用退出时独立守卫给予 60 秒收尾，再按身份终止应用树；超时尚未完成的写入可能中断，重启沿已提交事实恢复。模型 API key/header/auth.json 配置命令也已异步托管，列表不提前执行、结果不写回凭据；退出请求处理前已阻塞等边界仍待补齐。
- 设置 → 记忆使用一个可直接编辑的 MEMORY.md，支持更改路径、真实大小/预算提示与打开编辑。主会话每次调用动态读取，仅在用户明确要求时引用原话追加/删除；worker 不自动读取。预算约 2k tokens，超限需用户精简。
- 设置 → 项目与工作区仅配置主对话默认工作区，最近任务项目只读展示，配置保存于 `~/.rally/workspace.json`；主会话 cwd 固定，相对读取按默认工作区解析，worker 的绝对 cwd 由 router 明确指定。顶部栏保留拖拽区域。
- 已接入 task_read 六种视图与分页、派发 60 秒幂等、20 条结束任务窗口及 scope 交叉提醒；主/worker 的真实工具调用可折叠查看并随重启恢复。完整访问痕迹与费用投影仍待实现。
- worker 问题支持逐字卡片、选项直达、主对话原话代答、自动上升及重复问题去重；答复/失效历史持久保留。内门已接 MCP、受控删除与 worker git 分档。
- 设置 → MCP 支持新增多个服务器和逐项编辑，可选择直接披露、搜索披露、代码模式或隐藏，支持服务器默认值及原始工具名/通配符覆盖。搜索披露复用 Pi tool_search，命中后才把工具加入后续模型调用；风险档与内门仍生效。主 agent 只获得 Skills/MCP 的能力摘要，由 worker 使用技能正文和 MCP。新启动/续接会话读取设置，已运行会话保留原配置。
- GitHub 工具复用本机 gh 登录：主会话只查询 issue/PR，worker 可创建和评论，执行前提示并审计；发帖仍要求用户原话授权。PR 创建要求已推送的 head，正文通过 stdin 原样传入。进程纳入登记和取消清理，记录仓库主机访问尝试；尚未验证真实账号与企业实例。
- 主/worker 可用 fetch_page 读取静态网页 Markdown，worker 另有 http_request 六种 HTTP 方法；支持文本分页/截断、超时和取消，逐跳记录域名/方法访问尝试。无脚本执行、浏览器登录状态或自动重试。联网检索 web_search 仍待选型；按用户“不要过度开发”的要求，本轮收口后停止继续扩项。
- 后台窗口系统通知已接入上升问题/内门、失败/受阻及任务完成；完成提醒可在设置 → 通知关闭。点击前置窗口并定位问题卡或只读任务详情，启动恢复不补发；实际 Windows 通知体验待用户验收。
- 主会话中继持久保存、按 relayId 去重与恢复，报告按顺序合并/steer；通知重启后仍不主动唤醒。新机制启用前的旧中继缺少载荷与确认信息，不追溯补发。
- worker 的 write/edit/file_delete 已接读后被改检测：成功 read 记录整文件 mtime/哈希，外部改写后返回 STALE_FILE 要求重读；基准随任务会话保存，重启续接仍有效。
- file_delete 默认预览数量/字节/未提交改动/目录外目标；实删冻结完整清单并走内门（产出与可确认的新建文件除外），批准后重验，逐项记录实际删除。链接不跟随目标，失败保留未执行项；确认卡展示删除风险。
- 主会话 git_inspect 支持只读 status/log/diff/show/branch；cwd 随默认工作区，branch 固定列出，禁止写文件及修改参数。worker git 按子命令和配置识别可逆、external、不可逆档；不可逆动作走内门，普通 push 审计并提示，访问记录标注仓库命令范围。长输出有完整日志，取消清理本次 Git 进程树。
- 浏览器采用独立 partition 的 WebContentsView，支持真实服务预览、HTTP/HTTPS、导航历史和多个标签；远端页面无 Rally IPC。保留原型地址栏/起始页样式，菜单/设置遮挡时隐藏原生视图，关闭释放资源。下载及尚未开放的页面权限提示使用系统浏览器；实际 Electron 视觉和窗口行为待用户验收。
- 用户终端使用 xterm.js + node-pty，优先 PowerShell 7、否则 Windows PowerShell；从默认工作区或任务目录启动，支持多个标签、中文/emoji、查找和尺寸同步。切换标签/设置保留会话，关闭确认清理进程树；终端输入输出不进入 agent 上下文或任务记录。实际键盘/粘贴/视觉待用户验收。
- Electron + 本地假模型的派发到汇报链路已验证；用户已完成该基线的真实供应商 Messages/Responses 与现有能力验收，见 [测试清单](docs/测试清单-提供商与模型.md)。后续已接入 Skills/项目信任、worker MCP、逐工具风险档、内门、受控删除、Git 分档、后台作业和服务生命周期（长命令通知、输出/停止、服务列表及恢复）；新能力以离线回归验证，真实供应商与视觉待用户验收。HTTP/OAuth 验证、完整访问痕迹与所有会话关闭挂死边界等仍待推进。

## 开发

需要 Node >= 22.19，且仓库必须放在 NTFS 分区（npm workspaces 在 Windows 上依赖 junction，exFAT 不支持）。

Windows x64 的 node-pty 1.1.0 自带预编译模块，已用仓库 Electron 的 Node 模式验证构建宿主及 ASAR 路径；安装继续使用 `--ignore-scripts`，无需先跑原生重编译。node-pty 整包按打包配置解包，NSIS 实际安装仍待验证。终端集成与依赖版权说明位于 `THIRD_PARTY_NOTICES`。

```bash
npm install --ignore-scripts              # 不跑依赖的生命周期脚本
node node_modules/electron/install.js     # 单独下载 Electron 二进制
npm run hydrate:model-data                # 生成模型数据（需联网）
npm run build:packages                    # 构建 packages/*
npm run dev                               # 启动应用
```

根目录 `icon.png` 是应用图标唯一源文件。`npm run icons` 生成忽略目录 `build/icon.ico`（16/32/48/256）；`dev`/`build` 自动生成。窗口、Windows EXE、安装/卸载图标及托盘沿用此图，托盘提供显示/退出，关闭主窗口仍退出应用。实际 Windows 显示待用户验收。

其它命令：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 构建 packages 和应用 |
| `npm run typecheck` | 类型检查（packages、main/preload、renderer） |
| `npm run dist` | 构建并打包 NSIS；已生成本机安装包；配置 `npmRebuild: false` 跳过原生依赖重建，实际安装仍待验收 |

冒烟检查：先 `npx electron-vite build`，再设置环境变量 `RALLY_SMOKE=1` 运行 Electron。它会打印 JSON 结果后退出，不弹窗。

## 目录

```text
src/main/       主进程：模型配置、Supervisor、窗口、IPC、~/.rally 路径
src/preload/    contextBridge 暴露 window.rally
src/shared/     IPC 契约
src/renderer/   界面（来自 example/rally-ai-agent-ui-design）
packages/       Pi 源码，已改名为 @rally/*
docs/           设计文档，docs/superagent/00-问答记录.md 是决策依据
example/        上游参考（不入库）
```

离线任务回归（不调用真实 API）：

```powershell
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/rally-supervisor.test.ts
```

不要跑全量 vitest。根类型检查目前受两个已知模型数据测试报错影响；应用 main/preload、renderer 的独立类型检查与完整构建已通过，详见实施 TODO 的验证记录。

## 许可

Rally 采用 [MIT License](LICENSE)，Copyright (c) 2026 WEP-56。

`packages/*` 来自 [Pi](https://github.com/earendil-works/pi)（基准 `085c84e`，v1.5.0，MIT，Copyright (c) 2025 Mario Zechner）。各包内的 `LICENSE` 和 `THIRD_PARTY_NOTICES` 在分发时必须保留。
