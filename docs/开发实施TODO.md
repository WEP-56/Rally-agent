# Rally 开发实施 TODO

更新：2026-11-10。决策以 [00-问答记录](superagent/00-问答记录.md) 为准。本文件记录实施与验收，不替代设计。

勾选规则：`[x]` 表示已有实现且通过所列验证；仅有类型、函数、事件名称或历史交接声明不算完成。自动化验证与真实供应商/UI 验收分开；后者未验收前不得称阶段完成。每次开发同步更新本清单、测试清单和交接摘要。

## 当前收口：修复已有声明与测试清单的缺口

- [x] 主/worker 的 resource loader 显式加载；请求中使用 Rally 角色契约，不落回 Pi 默认身份与失效 docs 链接。（集成测试、Electron 实际 HTTP 请求）
- [x] 主会话实际声明 8 个任务工具并可执行派发与控制，保留只读工具；worker 声明汇报、任务读取和命令工具，无子 agent。（集成测试、Electron）
- [x] 用户输入携带宿主消息 ID，派发/追加/代答复制原话，note 统一描述及 30 词校验；主 agent 备注不写步骤的纪律已写入角色契约。（原话、无效引用、备注长度回归）
- [x] 两个全局模型与思考档位共用 Rally 供应商配置；worker 启动/续接使用当前设置，运行中模型不跟随切换。（离线回归、Electron 选择器及高档位实际请求）
- [x] 模型配置持久化、删除失效 selection、非法档位拒绝、缺少 worker 模型明确失败、模型请求失败后可恢复。（定向测试）
- [x] 全局审批开关接入主进程并持久化；待批准卡放主对话且展示原话/cwd/mode；开关不追溯旧任务。（离线回归、Electron 重启）
- [x] 生产会话的离线链路：派发 → 待批准 → 批准 → worker 读文件 → 汇报 → 唤醒主会话。（faux provider；Electron + 本地假 Messages 服务各验证一次）
- [x] 基本取消、启动取消竞态、依赖失败、默认 2 名额、空闲 worker 排队唤醒、同 JSONL 续接、重启 interrupted 待决。（集成测试；进程树强杀另列未完成）
- [x] 上下文整理调用压缩、保留界面历史与原话 ID；按钮/菜单/快捷键文案一致。（压缩回归、UI 源码核对；完整重注入另列未完成）
- [x] 显示真实任务状态，移除模拟百分比；右栏只读，工位展示实际主/任务模型。（类型检查与 Electron 截图核对）
- [x] 只读任务 write/edit 限产出目录（包括路径穿越及 junction）；成功写入才记录 changedFiles；终态拒绝工具及晚到汇报。（定向测试；shell 不作沙箱）
- [x] worker 问题代答携带 questionId 和逐字原话，拒绝旧问题；受阻只读任务可重新审批后升级改写。（定向测试；上升卡片/兜底另列）
- [x] 根类型检查、应用双端检查、完整构建、定向测试记录实际结果。（见下）
- [x] 更新 README/HANDOFF/测试清单，撤回“任务编排已完成”“双模型 v1 不做”等错误结论。（文档交叉核对）
- [x] Electron UI 使用隔离配置和本地假服务验证两套模型/高档位、主对话审批、完整任务与重启恢复。（`.artifacts/ui/` 本机证据）
- [x] 真实供应商 Messages/Responses 与完整现有能力验收。（2026-11-09 用户确认：双协议与现有能力完整测试均通过）

## 后续协议补齐（当前收口完成后再推进）

- [x] 仅主对话默认工作区可配置、最近任务项目只读；主只读工具相对路径按默认工作区解析，主 session cwd 固定，worker cwd 由 router 显式指定绝对路径。顶部栏不增加入口，保留拖拽区。（25 项离线回归、Electron 设置/重启及 960px 浅深色验证；原生拖动待人工验收）
- [x] 主/任务对话连续内容修复：主对话恢复原间距，按 assistant 内容块顺序展示 loop 中的文字、默认收起的 thinking 与工具调用；worker 中间消息接入流式展示及持久化。（28 项离线集成＋2 项静态渲染测试通过；2026-11-09 用户确认“没问题了”，允许后续开发）
- [ ] cwd 提示专项模型行为验收：提示词已明确项目目录已知时使用该目录、未知时询问，普通日常事务无指定目录时显式传默认工作区；测试清单 #42–43 尚未单独确认。
- [ ] 工具规格逐字段收口（以下完成项不代表全部工具契约完成）：
  - [x] task_read 六种 view、列表分页、真实工具 timeline、worker 仅自己/直接上游可见；board 保留全部未结束＋最近 20 个结束任务；续接无新汇报时保留最近已有汇报。（离线回归）
  - [x] dispatch 60 秒幂等，引用排序去重，跨重启有效；resume 返回 runN/审批等运行状态。（离线回归）
  - [x] 更新、续接、实际启动时 scope 交叉提醒并记事件，不阻断/加锁。（离线回归）
  - [x] 按原型展示主/worker 折叠工具活动：参数摘要、状态、耗时、有界输出；重启恢复、无重复消息、遗留运行显示中断。（离线＋Electron）
  - [x] card 返回累计运行耗时与可恢复用量（输入含缓存、输出、工具次数）；有真实计费/价格数据才累计费用，未知费用明确不完整。最终汇报后的增量独立落盘并推送。（离线回归）
  - [x] files 分页返回成功 read/grep/find/ls 的路径或搜索根、成功 write/edit 的路径及 created、shell 调用的 cwd/命令；changedFiles 从写入证据恢复，失败文件工具不记成功访问。（离线回归；搜索工具逐项实测另列下一批）
  - [x] dispatch/reuse 返回真实排队原因，approve 返回状态，steer/answer 返回实际投递情况（含等待名额），cancel 返回受影响下游；report 返回 recorded/notifiedMain/taskEnded，支持 question=null 清除及终态清除。（离线回归）
  - [x] task_read report 返回实际未决内门。（内门专项与生产集成）
  - [x] file_delete 成功实删逐项记录 fs_delete；同调用多个路径均保留，changedFiles 与分页/重启恢复覆盖删除。（删除专项）
  - [ ] 完整 files 网络/作业/服务访问痕迹、cancel.killedJobs 与完整投影；现有 coverage 明示缺口，shell 效果仍 unknown，旧访问历史与旧缓存用量不补录。
- [ ] worker 资源加载及真实设置接线：
  - [x] worker 按 cwd 加载项目 AGENTS 与 skills 目录；skills 名称/描述/路径进入模型请求，正文由 read 按需加载；主会话不自动加载。（34 项离线集成回归）
  - [x] Skills 设置展示实际发现列表、加载诊断、目录导入及持久化启停；新建/续接 worker 读取最新配置。（35 项离线回归与应用构建；视觉待用户验收）
  - [x] 项目信任设置接 Pi trust.json，展示/授予/撤销及目录继承；worker 和 skills 发现共用信任决定，未知/拒绝项目不加载项目配置与 skills，AGENTS 保留。（36 项集成＋4 项信任单测；视觉待验收）
  - [x] MCP 全局配置设置接入实际 mcp.json，支持 JSON 编辑/校验/启停/删除；项目配置合并遵守信任状态。（37 项离线回归；视觉待验收）
  - [x] worker 接入 Pi MCP，默认 direct 工具声明；主会话不加载 MCP；正常任务收尾发 session_shutdown 释放连接。（38 项集成，含真实本地 stdio 假服务调用/子进程退出）
  - [x] MCP stdio 取消/退出清理：同时 abort 与 session_shutdown，等待启动中和关闭中会话；Electron before-quit 等待 Supervisor 清理。（44 项离线集成含挂起初始化/调用、主/worker 启动退出；Electron 原生退出待用户验收）
  - [x] MCP 逐工具风险设置、external 提示/审计、irreversible 内门；direct/codemode 均强制，批准后仅向服务器发原参数，项目设置不能降低风险档。（49 项集成＋6 项内门专项；UI 视觉待用户验收）
  - [ ] MCP 连接状态 UI、HTTP/OAuth 边界及项目扩展执行。
- [x] 读后被改检测（mtime/hash）：
  - [x] worker write/edit 写盘前检查，成功 read 及自身写入更新基准；整文件哈希、路径别名、任务续接/重启持久化。（63 项生产集成＋11 项专项；真实供应商行为待用户验收）
  - [x] file_delete 接入同一检查，递归目录中的已读文件与原路径别名均校验；预览不刷新已读基准。（19 项删除专项＋生产链路）
- [x] scope 交叉警告覆盖排队后启动/续接/更新。（25 项定向回归）
- [ ] 构建产物真正隔离或构建串行（仅注入环境变量不算实现）。
- [x] worker 逐字上升卡片、选项回答、自动兜底与相同问题幂等；原话代答/选项直达遵守名额，旧问题失效、历史持久保留。（55 项生产离线集成＋7 项问题专项；视觉与真实模型行为待用户验收）
- [ ] 调度额外名额、后台作业占位、卡死检测与重试。
- [x] 中继持久队列、至少一次投递、relayId 幂等与失败恢复；报告源事件补入队、Pi 上下文消费确认、通知恢复不唤醒、发送失败重试。（60 项生产离线集成＋9 项中继专项；旧版缺载荷/确认的历史不追溯补发，完整事件恢复另列）
- [ ] 完整工具投影、文件/域名/作业/服务访问痕迹、用量与费用、退出码/diff；已有基础工具时间线，shell 改动明确标 unknown。
- [ ] 长命令自动转后台、job_output/job_kill、作业结束唤醒。
- [ ] service_start/stop/status、服务列表/预览、用户停止服务直连与事件审计。
- [x] 受控 file_delete：默认 dry-run、完整清单内门、产出/新建文件例外、只读检查、批准后重验、链接不跟随、逐项删除与失败/未执行清单；确认卡展示未提交改动与 cwd 外目标。（19 项专项＋67 项生产集成；真实模型与视觉待用户验收）
- [x] 主会话 git_inspect：动态 cwd、五种只读查询、branch 列表模式、参数允许清单、长输出日志和取消进程树；拒绝修改/输出文件/有歧义的路径分隔符。（26 项专项＋68 项生产集成；真实模型与视觉待用户验收）
- [x] worker git 分档/内门/external 审计与访问投影：结构化 argv、远端配置/强推 refspec、批准后上下文复核、只读边界、仓库范围访问记录。（专项 66/66＋补充 push 子集 4/4，生产集成 71/71；真实模型与视觉待用户验收）
- [ ] 联网检索/抓取/HTTP、GitHub 工具。
- [x] 内门服务：挂起、原话引用校验、主模型判断动作/范围覆盖、上升确认及自动兜底、超时拒绝、取消/退出/恢复失效与独立审计；已接 MCP、file_delete、git 强制点。（真实模型对范围的判断及确认卡视觉待用户验收）
- [ ] 完整审计动作/字段验收：gate/external、手动批准/代答/选项回答/取消已验证；问题 ID、原话依据及按钮归因已补齐，记忆 append/remove 审计已接；未来受控工具及完整字段验收仍待做。
- [x] 简版 MEMORY.md、原话引用工具、每次模型调用动态重读、真实路径/打开编辑设置。（7 项专项＋生产集成增量；明确意图的语义判断由主模型执行，真实模型与视觉待用户验收）
- [ ] 压缩后任务状态重注入、chat_search、会话与事件物理分段。
- [ ] 事件快照、完整恢复流程、孤儿进程清理、优雅中止超时升级进程树终止。
- [ ] WebContentsView 独立 partition；xterm.js + node-pty 用户终端。
- [ ] Windows 通知、长路径/编码实测、NSIS 安装包与工作区依赖打包验证、更新。
- [ ] 将用户设计的根目录 `icon.png` 接入应用图标，生成所需 Windows 图标资源，用于快捷方式、任务栏、托盘和安装包，并验证实际显示。
- [ ] 定时任务 worker
- [ ] markdown 渲染
- [ ] 浏览器控制集成、computer use集成

## 验证记录

本轮修复前：`npm run typecheck` 在两个已知模型测试文件失败；主进程/渲染层独立类型检查通过。用户实测 #21 派发失败、角色提示词未加载，故当前阶段未验收。

2026-11-09 本轮：

- `packages/coding-agent/test/suite/rally-supervisor.test.ts`：生产 Supervisor + SDK + faux provider，17/17 通过；包含运行中取消与模型固定回归，收尾复跑仍全部通过。
- `npm run typecheck`：失败仅来自既有 `packages/ai/test/fireworks-models.test.ts`、`anthropic-empty-thinking-signature-compat.test.ts`（模型数据与测试断言不一致），不记为通过。
- 应用 main/preload、renderer 独立 `tsc`：最终代码复核通过；`npm run build`：最终代码完整构建通过。
- Electron + 本地假模型：两套选择器、worker 高档位参数、审批到汇报、审批开关及模型/任务重启恢复通过；renderer 异常 0。截图及请求摘要 `.artifacts/ui/`，脚本使用隔离临时目录，不读取真实供应商密钥。
- UI 证据范围为浅色最大化窗口；窄窗口与深色外观未完成验收，不据脚本中的尝试记为通过。
- 开发期间未调用真实模型/API；2026-11-09 用户另行完成真实供应商 Messages/Responses 双协议及现有能力完整测试，确认均通过。当前收口已验收，可继续后续 TODO；后续协议缺口不因此视为完成。

2026-11-09 工作区修订与工具增量（覆盖早先“当前项目切换”方案）：

- 已先提交已验收基线 `74f7dee`；本节新增功能尚未提交。
- 设置页唯一可配置项为主对话默认工作区；`~/.rally/workspace.json` 仅保存该值和最多 10 个最近任务项目，忽略旧 currentProject。最近项目在 worker 实际启动时记录，不可选择。顶部入口移除，中间恢复拖拽区。无效路径保留原配置，新工作区创建 notes/reports/repo。
- router 每次模型请求获得最新目录上下文，read/grep/find/ls 相对路径按主对话默认工作区解析；不变更主 session cwd、不自动加载项目指令。worker 派发/更新必须显式传绝对 cwd；已有任务 cwd/产出目录不迁移，新建产出使用新工作区。
- 定向回归 25/25 通过；新增覆盖工作区语义、派发幂等与 60 秒边界/重启、view/分页/历史窗口、worker 可见范围、scope 提醒、生产工具活动与恢复中断。应用 main/preload、renderer 独立类型检查及 Electron 应用构建通过；根 typecheck 仍只有上述两个既有模型测试文件错误。
- Electron 工作区验证：隔离 HOME/AppData，覆盖单输入、只读最近项目、旧选择忽略、选择类 IPC 拒绝、无效路径、浏览接线及重启；960px 浅深色截图目视检查无溢出，renderer 异常 0。目录选择器返回值用自动化替身；拖拽只核实命中区域不在 no-drag 内，未做原生鼠标移动窗口实测。
- Electron 工具验证：隔离配置＋本地假 Messages 服务，审批 → worker 读 README → 汇报 → 唤醒；展开主 task_dispatch、worker read/task_report 可见输出，重启后活动保留且主消息 ID 不重复；renderer 异常 0。
- 本机证据 `.artifacts/workspace-revised-ui/`、`.artifacts/tools-ui/`，不入库；新增能力未调用真实供应商，用户此前双协议验收对应基线版本。完整访问痕迹/门控等缺口保持未勾选，图标接入仍为待办。

2026-11-09 主对话间距与目录纪律补充（后续连续内容修正见下）：

- 主对话消息间距由 gap-6 调至 gap-4；无文本/工具/任务卡的结束消息不占布局，工具记录不再附空文本块；仍保留流式等待提示。任务页布局未改。
- 主角色提示词与 Q5/提示词文档同步：每次派发显式携带绝对 cwd，按开发项目或日常事务选择；项目位置不明确先询问，普通日常事务无指定目录则用默认工作区。提示词已构建，真实模型行为未实测。
- 应用 main/preload、renderer 独立类型检查及应用构建通过；根 `npm run typecheck` 仍只有两个既有模型数据测试文件报错。未新增或执行视觉自动化；用户负责视觉验收的约定已写入根 AGENTS.md。

2026-11-09 assistant loop / thinking 连续内容修正：

- 用户指出断续感来自中间内容缺失，主对话恢复 gap-6。主会话使用有序 blocks 保留 text/thinking/tool 引用，工具执行结果绑定到原 assistant 消息；不再统一把工具列表摆在文字前面。纯 thinking 消息也显示，默认收起，与工具调用同级。
- worker 的中间消息此前仅用于内部 lastText，任务页只由原话/最近汇报拼接。现按每条 assistant 消息持续推送，完成/中止时落事件日志，关联该消息真实工具结果，重启按 ID 恢复；旧记录仍使用原汇报＋最近工具展示。不会从旧 Pi JSONL 补录此前未保存到 Rally 事件流的思考/worker 叙述。
- 仅展示供应商实际返回的可读 thinking，不展示签名、加密或 redacted 数据；未返回思考内容时不虚构。worker 完整对话仅供用户界面，task_read 的 board/card/report/runs/files/timeline 都不附带这些消息。
- `rally-supervisor.test.ts`：28/28 通过，含连续 10 次工具调用的中间文字/思考顺序、worker 流式接收、重启/中断恢复与 task_read 不外泄完整对话。
- 无浏览器静态渲染测试 `src/renderer/src/components/AssistantContent.test.ts`：2/2 通过，覆盖文字/思考/工具顺序、默认收起、纯 thinking 可见及空记录隐藏。命令：根目录 `node node_modules/vitest/dist/cli.js --config vitest.base.ts --run src/renderer/src/components/AssistantContent.test.ts`。
- 应用双端类型检查、应用构建通过；根 typecheck 仍仅两个既有模型数据测试文件报错。未启动截图/浏览器/Electron 视觉验收，视觉和真实供应商行为待用户确认。

- 2026-11-09 用户随后确认“没问题了”，本轮连续内容修复验收通过，要求更新 HANDOFF 后在新会话继续。未将该确认扩大为 #42–43 或新一轮双协议全量测试通过；后续未实现项仍保持未勾选。本次交接只改文档，未提交代码。

2026-11-09 工具返回字段、访问痕迹与用量持久化：

- 修复 usage 只在内存累加导致最后一条回复/汇报工具计数重启丢失；每次 message_end/tool_execution_end 的增量落 usage_updated 并推送。输入 token 包含缓存读写，保留缓存分项；costUsd 仅累计已知费用，costIncomplete 标记存在未知请求，零价格配置不当作免费。
- card/board 增加 durationMs，按多次运行的时间累计，终态后不再增长。files 的 accesses 按调用顺序分页，changedFiles 保留已知改动汇总；记录文件工具成功访问及新建标志，shell 仅保存 cwd/命令（即使非零退出），不解析其文件/网络效果。access_recorded 已落盘但后续快照未落盘时，也可恢复 changedFiles。
- 补齐 task_dispatch/approve/steer/answer/cancel/report 的已有能力返回字段；未启动追加原话返回 queued_with_first_message，已启动但尚未拿到名额返回 queued_for_worker。取消不把已完成任务改报为 cancelled；作业未实现，不虚报 killedJobs=0。report 支持显式清除问题，终态清除未决问题；相同问题幂等、上升和兜底仍未完成。
- 定向生产 Supervisor＋faux provider 回归 33/33 通过（包目录运行 `node ../../node_modules/vitest/dist/cli.js --run test/suite/rally-supervisor.test.ts`），含写入证据落盘与快照之间中断的恢复；无浏览器静态渲染 2/2 通过。应用双端类型检查通过；根 `npm run typecheck` 仍仅两个已知模型数据测试文件报错。`npm run build` 完整构建通过，最后恢复补丁后双端检查与 `node node_modules/electron-vite/bin/electron-vite.js build` 再次通过。
- 未调用真实供应商，未启动浏览器/截图/Electron 视觉验收；本轮未改界面布局，真实供应商增量行为仍待用户验收。grep/find 的访问提取已接入统一包装，本轮实测覆盖 read/ls/write/edit 和失败 PowerShell；搜索二进制路径及 grep/find 的定向实测保留下一批，不隐式联网下载工具。

2026-11-09 worker skills 与搜索访问回归：

- worker 启用 Pi 现有 skills 发现；模型请求收到目录条目并能按绝对路径读取正文。主会话继续关闭 skills/项目上下文，扩展仍关闭，尚未接入 MCP、信任管理和原型设置页。
- 生产 worker 的 grep（文件路径）与 find（默认 cwd）实际运行本机已安装二进制，访问记录进入 files 分页并能恢复。离线集成设置 PI_OFFLINE=1，缺少搜索工具时不下载。
- 定向集成 34/34 通过；应用 main/preload、renderer 独立类型检查和完整 npm run build 通过。npm run typecheck 仍仅两个既有模型数据测试文件报错。无真实供应商调用、无视觉验收、无提交。
- 复跑曾因多工具＋PowerShell 链路超过默认等待时间而提前清理，出现临时目录占用；该真实子进程用例改为 10 秒等待后，最终复跑 34/34 通过。

2026-11-09 Skills 设置接线：

- 新增 SkillStore，共用 Pi 资源发现结果，枚举全局、默认工作区和最近任务目录的 skills；导入引用原目录，不复制或修改 skill 文件。rally-skills.json 保存导入路径和按规范化文件路径记录的禁用项；配置损坏明确报错。
- 经 shared/ipc 声明的 skills 通道连接主进程/preload/设置页。替换模拟 skills 列表与假导入，保留原型卡片/token，增加刷新和加载诊断。worker 新建或续接读取最新偏好，当前运行会话不热切换，主会话不加载。
- 生产 faux provider 集成 35/35，通过导入去重、无效目录拒绝、持久化恢复、关闭/开启后实际 worker 请求变化；应用双端检查和完整构建通过。根 npm run typecheck 仍仅两个既有模型数据测试错误。未启动视觉验收、未调用真实供应商、未提交。

2026-11-09 项目信任接线：

- 设置新增项目信任，复用 Pi trust.json 的规范化路径、父目录继承与子目录覆盖；已保存目录即使不在最近项目中也可管理，撤销写入 false 防止再次继承父目录授权。扩展和 MCP 执行仍未启用。
- worker 的 loader/SDK 共享显式信任设置；未知或拒绝的项目不加载项目 settings/skills，AGENTS 保留。主会话不加载项目设置。Skills 列表采用同一信任决定；用户显式导入路径仍是全局资源。改变信任仅影响后续新建/续接会话。
- 生产集成 36/36、单文件 trust-manager 测试 4/4；修正后者的 .pi 硬编码和宿主祖先 .agents 目录污染。完整构建及重建 Pi 声明后的应用双端类型检查通过；根类型检查仍两个既有模型数据测试错误。视觉和真实供应商留给用户，无提交。

2026-11-09 MCP 配置接线：

- 设置页由 localStorage 模拟 MCP 改为真实 agent/mcp.json：列表、启停/删除、JSON 添加/编辑、校验错误展示；去掉随机工具数量及假连接状态。保留原型 token/卡片。界面明确当前只配置，worker 连接与工具执行仍未接入。
- 复用 Pi validateMcpServerConfig/loadMcpConfig 并导出 SDK 接口。保存校验服务器结构/命名冲突后原子替换，失败保留原文件；启停保留 env/headers/args 等字段。forProject 复用已保存的项目信任合并项目覆盖，尚未用于建立连接。
- 集成 37/37，通过保存恢复、无效保存保护、命名冲突、字段保留、删除和信任合并；使用无效命令/域名证明仅配置，不启动服务器。应用双端检查、完整构建通过，根 npm run typecheck 仍两个已知模型测试错误。无真实供应商/视觉验收，无提交。

2026-11-09 worker MCP 基础执行：

- worker 加载 Pi 内置 MCP（与 codemode/tool_search 支持扩展），不启用任意项目扩展。默认 MCP exposure 为 direct，显式 exposure 保留；动态工具加入允许列表，启动时 bindExtensions 发 session_start。
- 新增全工具终态 hook，覆盖 MCP 动态/嵌套工具；读取全局 settings.mcpTiers，存在且非 reversible 的工具暂返回 MCP_RISK_GATE_UNAVAILABLE，非法整体配置拒绝。风险档 UI、external 审计和 irreversible 挂起审批仍未实现。
- closeRoleSession 幂等发送 session_shutdown 后 dispose，正常完成释放 stdio 子进程，abort 路径等待关闭；应用退出等待、启动取消/挂起连接/HTTP/OAuth 等边界仍需验证。连接错误尚无完整设置页状态投影。
- 生产集成 38/38，包含真实本地 Node stdio 假 MCP 的初始化/声明/调用、主会话无 MCP、终态晚调用及风险工具不触达服务器、正常收尾后 PID 消失。应用双端类型检查、完整构建通过，根检查仍两个已知模型测试错误。未连接真实外部 MCP 或供应商、未视觉验收、无提交。

2026-11-09 MCP 取消与退出清理：

- 会话关闭并行触发 abort 与 session_shutdown，然后释放 SDK；避免初始化未响应时只等待 abort。WorkerManager 记录启动中/关闭中的 Promise，关闭从活动表移除后仍可等待，同任务续接不与旧会话重叠。取消和退出把当前未结束工具记为 interrupted 并保存结束时间。
- Supervisor、主会话、worker 的 dispose 可等待且幂等；启动途中退出会等待资源加载并释放晚创建的 session。Electron before-quit 首次 preventDefault，清理完成再 quit；退出不伪造任务失败/完成，原运行留待下次 interrupted 恢复。
- 生产集成 44/44，通过本地 Node stdio 假 MCP 的挂起初始化/挂起调用 × 取消/退出四个场景，关闭 Promise 返回即检查 PID 消失；另两个用例覆盖 worker 与主会话加载期间退出。afterEach 先等待 Supervisor 清理，再移除临时目录；测试未调用外部 API。
- npm run typecheck 仍仅 packages/ai/test 两个已知模型数据测试文件失败；应用 main/preload、renderer 独立 tsc 与完整 npm run build 通过。未启动 Electron/浏览器/截图，原生退出、视觉和真实供应商由用户验收。一般 shell/作业/服务进程树强杀、崩溃孤儿清理未完成，HTTP/OAuth 和风险门控仍是后续项。无提交。

2026-11-09 MCP 风险档与内门：

- 设置页按实际发现/已配置的工具名管理三档，支持输入完整工具名。mcpTiers 存在全局 settings.json，保留其他设置；每次调用读取最新档位，非法配置拒绝调用，项目信任不能降低全局风险。工具名缓存只说明曾发现，不代表在线。
- MCP 声明采用 {arguments, approval?} 包装，完整原 schema 嵌套保留，包括 additionalProperties；宿主 action/scope/alternative 不发往服务器。tool_call hook 在 direct 和 codemode 嵌套调用上均生效。external 记录调用尝试和右栏提示；irreversible 缺上下文直接拒绝，有上下文冻结原参数并挂起。
- GateService 记录未决门/决定，gate_decide allow 必须引用真实用户消息；语义覆盖仍依主 agent 判断（02 §2.3）。escalate 当前仅支持 kind=gate，主会话处理完中继仍未决定则自动上升。主对话确认卡逐字显示请求、范围、替代方案和原参数，倒计时，结果折叠；右栏保持只读。
- 120 秒／上升后 10 分钟到期拒绝；重复上升不延时，晚批准 GATE_STALE；同任务同时最多一个未决门。任务取消、应用退出、重启拒绝未决门；不沿用旧批准。audit.jsonl 单独追加，每次门决定记录 actor/basis/动作/范围；审计写入失败不得放行。已接手动批准/代答/取消的基本审计，完整字段和动作覆盖仍未勾选。
- 生产集成 49/49；新增 external 不阻断、运行中升档生效、原话 gate_decide、项目降档无效、direct/codemode 原参数执行、自动上升/用户拒绝、取消/晚批准。内门专项 rally-gates.test.ts 6/6，覆盖上下文/引用校验、两档超时、重复上升、用户允许/主模型拒绝、取消/退出、审计失败及重启恢复。静态渲染 3/3，验证文本转义、逐字字段、结果折叠；无浏览器。收尾边界补测 3/3。
- 应用双端 tsc 与完整 npm run build 通过；根 npm run typecheck 仍两个已知模型数据测试文件报错。未调用真实外部 MCP/供应商、未做视觉验收、无提交。file_delete/git 强制点、问题上升、HTTP/OAuth/连接状态、扩展执行仍待推进，不能据本批勾完资源总项或完整工具契约。

2026-11-09 worker 问题闭环：

- escalate 支持 question/gate；主会话 settled 只兜底该轮已投递且仍未决的问题，不提前上升尚在 2 秒合并窗中的问题。问题原文含空白完整保存，选项冻结；同运行的相同问题/选项复用 ID，已答重报回传原答案，不再中继。
- 新增 QuestionCard 与 tasks:answer-option IPC。按钮只接受已上升且仍有效问题的原始选项，直接回传 worker，主 agent 只收不唤醒通知。自由输入仍由主会话 task_answer 引用真实用户消息；忙时 steer，空闲时按现有名额队列优先唤醒。
- attentionHistory 保存已答、替换、撤回、任务结束或运行结束的记录；取消/重启拒绝旧问题。TaskBoard.questions 单独投影主对话问题，任务超过右栏最近 20 个已结束窗口后，回答结果仍保留，重启可恢复。
- 修复回答审计因提前清除 attention 丢失 questionId/actor/basis；批准/回答/取消先写独立审计再变更状态。批准按钮 actor=button，选项/取消按钮 actor=user，basis=[]；主模型取消记录真实原话 ID。审计失败不消费问题、不批准/取消任务。
- 定向生产集成 55/55；问题专项 7/7（逐字、去重、替换、非法/旧按钮、清除/终态、审计失败、恢复和历史窗口），内门专项 6/6，静态渲染 4/4。命令分别为包目录单文件 vitest 的 rally-supervisor.test.ts / rally-questions.test.ts / rally-gates.test.ts，以及根目录 `node node_modules/vitest/dist/cli.js --config vitest.base.ts --run src/renderer/src/components/AssistantContent.test.ts`。
- 应用 main/preload、renderer 独立 tsc 与完整 npm run build 通过；根 npm run typecheck 仍只有既有 fireworks-models / anthropic-empty-thinking-signature-compat 两个模型数据测试文件错误。真实供应商及视觉待用户验收；未运行浏览器/Electron/截图，无提交。中继持久化及失败重投、完整审计、其余工具继续保留 TODO。

2026-11-09 中继持久化与失败恢复：

- 事件流持久保存待发完整载荷、源事件、relayId；启动恢复，未完成入队的报告/问题/门/依赖/中断及按钮通知从源事件补齐。按序合并约 2 秒，主 agent 忙时先送此前排队项；源事件和系统行去重，编号跨重启不重用。
- MainAgent 用 triggerTurn=true/deliverAs=steer 修复原上下文追加误当 steer。送入内存队列不确认，Pi 已落盘并取入模型上下文后写 relay_delivered。会话 metadata 保留 relayIds；存在于当前历史的未确认事实仅发恢复指针，压缩已移出上下文则重新注入载荷。通知 nextTurn，重启不自动唤醒。
- 发送异常保留载荷并按 1–30 秒退避；模型未配置则待可用事件唤醒。停止主会话不自动重启当前未读报告；下一次用户输入接回并去重。问题/内门已经关闭则丢弃过期操作请求并记事件。
- SessionManager 把 custom_message 也计为需要立即落盘的对话，避免首条中继触发的模型轮尚未回复时崩溃丢上下文；AgentSession 提供只读待发 custom 消息查询。EventLog 写盘成功后才发布内存事实，启动隔开 torn tail 再追加。底层 file-operations 回归发现并修复 2 处固定 pi 名称断言与 1 处 Windows 目录 chmod 测试假设。
- 生产集成 60/60，中继专项 rally-relay.test.ts 9/9；session-manager/file-operations.test.ts 35/35，suite/agent-session-bash-persistence.test.ts 16/16，均在 coding-agent 包内逐文件运行。覆盖真正忙时 steer、停止后未读队列、源事件/入队窗口、Pi 历史/确认窗口、通知重启、无模型待发、同 ID 失败重试、落盘失败重试、半行与 custom-only 会话持久化。
- 应用双端 tsc 与完整 npm run build 通过；根 typecheck 仍仅两个已知模型数据测试文件错误。未调用真实供应商/外部 MCP、未运行视觉验收、无提交。旧版无载荷/真实确认的中继不追溯重放；至少一次是模型上下文投递，不等于供应商成功生成、业务副作用 exactly-once 或完整 worker 输入恢复。后续继续读后改检测、事件分段/快照、worker readAt 与孤儿清理等。

2026-11-09 读后被改检测：

- 新增 supervisor/file-versions.ts，worker 包装 Pi read/write/edit。成功 read 记录实际消费的字节哈希、mtime、文件身份及规范路径；局部读取仍流式计算整文件 SHA-256，不另存文件正文。失败/取消的读取不覆盖旧基准，图片检测和处理保持 Pi 原有行为。
- write/edit 在 Pi 原有文件变更队列内、实际写盘前检查；其他任务/IDE/shell 修改、删除、替换、junction 改指及保留 mtime 的内容改写均拒绝为 STALE_FILE。edit 另核对其内部读取版本；成功自身写入按预期写入内容更新基准，允许连续编辑，不把刚发生的外部改写当成已读内容。实际写盘前复核终态/只读路径。
- 基准通过 Pi custom entry 持久保存，重启/同任务续接恢复；新建和本会话从未读取的文件沿用 Pi 语义，旧会话无版本记录的历史不反推。未来 file_delete 可复用 assertFresh，但尚未接入。无新增宿主锁；检查与操作之间仍非原子，不能阻断外部程序同时写盘，也不监视 shell 内部读写。
- 包目录逐文件执行：rally-supervisor.test.ts 63/63（新增 write/edit 失败后重读、Supervisor 重启续接），rally-file-versions.test.ts 11/11（mtime/hash、局部/失败/取消/并发读取、路径别名、排队取消、图片、跨任务与写后并发），tools.test.ts -t 'read tool' 12/12（其余 99 项未运行）。
- 完整 npm run build、应用 main/preload 与 renderer 独立 tsc、git diff --check 通过。npm run typecheck 仍仅 fireworks-models 和 anthropic-empty-thinking-signature-compat 两个已知模型测试文件错误。未调用真实供应商、未运行视觉验收、无提交。

2026-11-09 受控删除：

- worker 新增 file_delete，默认 dryRun=true；literal paths 不展开 glob，解析祖先 junction，但最终链接只删链接。matched/deleted 计实际文件系统条目，totalBytes 计常规文件字节，预览最多 50 条；门内保存完整清单。git 以参数数组执行只读 status，识别暂存/未跟踪等改动及 cwd 外目标，不把无效祖先 .git 目录当作仓库。
- 实删默认内门，动作/cwd/工具/范围/保留文件的替代做法由宿主真实生成；批准参数冻结。全部位于 outputDir 或均有本任务 created 访问证据及匹配创建版本的文件免门；只读任务可预览项目，实删只限 outputDir。新建文件使用独占创建标记来源；被外部改写后重读或替换身份后失去免门资格，旧历史无身份记录也不过度推断。
- 删除前检查已读版本，包含递归目录下的原读取别名；dry-run 不伪装成模型读取。批准后重扫完整范围，再按文件校验并逐项 unlink/rmdir，不使用递归 rm，等待期间新增内容不会被自动纳入。失败停止后续操作，返回真实 deleted 和 failed/NOT_ATTEMPTED；取消/结束/审计失败不放行。
- 成功删除逐路径记录 fs_delete，修复 TaskStore 仅按 toolCallId 去重导致批量操作丢路径的问题；changedFiles 从删除证据恢复，files.coverage 明示删除已接。删除版本 tombstone 随任务 JSONL 保存，合法删除后可重新创建同路径。确认卡沿用原 token 显示未提交/cwd 外清单，工具活动使用文件删除图标。
- 单文件离线验证：rally-supervisor.test.ts 67/67（新增两种模式免门、真实主会话原话内门与取消），rally-file-delete.test.ts 19/19，rally-file-versions.test.ts 11/11；静态渲染 5/5。最终边界补丁后另跑删除/STALE_FILE/访问证据生产子集及 readonly 预览专项。完整构建通过，最后改动应用构建复核通过；应用双端 tsc 通过，根 typecheck 仍两个已知模型测试文件错误。
- 所有实际删除与 git 初始化仅在 harness 临时夹具中；无真实供应商/外部 MCP、无浏览器/Electron/截图验收、无提交。检查与外部文件系统操作仍非原子，不承诺回滚、崩溃窗口内的完整访问日志或 shell 沙箱。git 分档、后台作业/服务、联网及其余 TODO 继续保留。

2026-11-09 主会话 Git 查询：

- 新增 git_inspect.ts、git-runner.ts 和 git-policy.json，仅主会话声明 git_inspect；cwd 在每次执行时按默认工作区解析，可显式指定目录。不使用 shell，branch 自动追加 --list，参数允许清单拒绝改动/输出文件/未知缩写；选项值可能吞掉 `--` 时要求附加值写法，不误把后续参数当路径。
- 禁用可选索引锁、索引刷新、fsmonitor、外部 diff/textconv、签名辅助程序和缺失对象自动补取；清除继承的仓库/索引/配置重定向、Trace 环境并以环境变量关闭全局 Trace2 目标。依据 Git 官方 [diff](https://git-scm.com/docs/git-diff)、[git](https://git-scm.com/docs/git) 与 [config](https://git-scm.com/docs/git-config) 文档核对这些副作用入口。
- 完整 stdout/stderr 超过 30k 字符写入 state/tool-output/main 的独占日志，模型得到首尾和 read 路径；保留退出码，日志存储失败返回错误。取消清理本次 Git 进程树，等待关闭再返回；不代表通用作业/服务的优雅中止和崩溃孤儿回收已完成。
- 包目录逐文件运行 rally-git-inspect.test.ts 26/26（本地 init/add、直接序列化对象夹具，无 git commit/push；包含历史/blob 查询、索引不变、参数绕过、cwd/环境、长输出、存储失败、真实子进程退出），rally-supervisor.test.ts 68/68（实际主会话工具声明、切换工作区、拒绝写入和重启历史）。完整 npm run build、应用双端 tsc 通过；npm run typecheck 仍仅两个已知模型数据测试文件报错。
- 未调用真实供应商，未启动浏览器/Electron/截图验收，无提交。worker git 分档/内门/external 与 Git 访问投影仍未实现；不存在以新增主会话查询代替 worker 受控工具的结论。

2026-11-09 worker Git 分档与内门：

- 新增 git-risk.json/ts、git-plan.ts、git-tool.ts。worker 声明 git；敏感命令解析完整选项/组合短选项/值/--，识别破坏性动作、显式及配置强推。普通 push 提示并 external 审计；其他声明为可逆的命令沿用真实 Git 执行和退出码。commit/push 仅原话要求的约束在 worker 提示；不做语义宿主审批。
- 核对真实 cwd、仓库/共用 git 目录、HEAD/refs、配置、pushRemote/pushDefault、remote URL/多个 pushurl、insteadOf/pushInsteadOf、refspec/pathspec；门冻结原始 argv，批准后指纹变化拒绝。位置仓库覆盖 --repo，push --tags 的显式 refspec 不继承配置强制 refspec，mirror 配置仍不可逆。别名/未知控制语法/远端组/递归 push 明确拒绝，不假定为安全。
- GateService 增加宿主 executionCwd，避免 cwd 覆盖时审批卡误显示任务原目录。配置仅内部读取/哈希，URL 展示脱敏；原始模型 args 仍记录。git-runner 新增 metadata 模式：元数据最多 16MiB、不落明文配置日志、stderr 不混入机器数据。worker 继续复用流式长输出和取消进程树。
- TaskAccess 增 net、coverage=command_scope、outcome=attempt；Git fs_read/fs_write 表示仓库命令范围，fetch/pull/push 主机表示解析目标。TaskStore 及重启不把 command_scope 添加到 changedFiles；files.coverage 明示精确文件、递归/hook/代理网络等缺口。readonly 查询复用五种只读入口；只有 outputDir 内独立完整仓库允许受支持的本地修改。
- 离线逐文件：rally-git.test.ts 66/66；最终 push/refspec 改动后子集 4/4（含新增 push --tags 配置覆盖）；rally-supervisor.test.ts 最终 71/71（worker add/status、readonly、取消门、主模型原话批准后实际错误退出码）；git_inspect 26/26。最终完整 npm run build、应用双端类型检查、git diff --check 通过；根 npm run typecheck 仍仅两个已知模型测试文件报错。
- 使用本地 harness 和 faux provider；强制/删除执行为 runner 替身，生产门批准只执行不存在路径的 restore 错误验证；没有真实远端 push/fetch、真实供应商、视觉验收或提交。元数据检查非原子仓库锁，hooks/其他内置命令/shell 非沙箱，精确 Git 文件 diff 仍属完整投影 TODO。下一步可推进简版 MEMORY 与每轮注入，或剩余作业/服务；尚有需要用户决策的联网检索服务商等项，按 docs 先查再问。

2026-11-10 简版 MEMORY：

- 主会话专属 memory_append/remove 核验原话引用，transformContext 每次重读 Markdown；工具循环、压缩后、重启可见新内容，快照不写入 Pi，worker 不注入、不声明记忆工具。明确记住/忘掉的语义判断仍由模型执行。
- 路径持久化、实际统计/预算、打开编辑和刷新接 IPC；取消模拟目录/向量库/自动整理/清空。新条目有成对边界，旧开始标记仅管理首段，无关手写段落保留；重复标记报错。记忆专用事件仅 ID/op，专用审计无正文、记录引用与哈希；普通工具历史仍保留参数。
- rally-memory.test.ts 7/7，rally-supervisor.test.ts 首跑 71/72（新增测试等待条件过早），修正后新增用例单独 1/1，既有 71 项含新 worker 隔离断言已通过。静态渲染 5/5；完整构建及最终应用构建、双端类型检查通过；根 typecheck 仅两个已知模型测试文件错误。未真实 API/视觉验收/提交。
- 预算为 6000 UTF-8 字节估算，超限截取开头并提示精简。写前重验不构成外部进程锁；真实模型语义、编辑器打开和视觉待用户验收。
