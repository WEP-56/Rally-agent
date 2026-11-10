# Rally 开发实施 TODO

更新：2026-11-10。决策以 [00-问答记录](superagent/00-问答记录.md) 为准。本文件记录实施与验收，不替代设计。

2026-11-10 阶段性验收：用户确认当前测试已完成，要求提交并推送 `WEP-56/Rally-agent`。MIT 协议及发布忽略规则已补齐，临时问题文档和图片由用户清理。本次确认覆盖当前阶段成果，不将未实现的 TODO 改成完成。

2026-11-10 最新推进边界：用户要求“不要过度开发，添油加醋哈。todo 做的差不多就可以停了”。已完成当时开工的 fetch_page/http_request 收口，至此停止继续扩项。剩余条目如实保留，不自动启动搜索服务商、定时任务或其他新一轮开发；以后按用户具体要求继续。

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
  - [x] files 记录后台作业 ID，cancel 等待作业整树停止并返回实际 killedJobs。（4 项作业生产链路回归）
  - [x] files 记录 service_start 返回的服务 ID，task_read services 返回本任务持久服务记录；worker 不读取其他任务服务详情。（服务生产回归与归属专项）
  - [ ] 完整 files 网络访问痕迹与完整投影；现有 coverage 明示缺口，shell/作业/服务效果仍 unknown，旧访问历史与旧缓存用量不补录。
- [ ] worker 资源加载及真实设置接线：
  - [x] worker 按 cwd 加载项目 AGENTS 与 skills 目录；skills 名称/描述/路径进入模型请求，正文由 read 按需加载；主会话不自动加载。（34 项离线集成回归）
  - [x] Skills 设置展示实际发现列表、加载诊断、目录导入及持久化启停；新建/续接 worker 读取最新配置。（35 项离线回归与应用构建；视觉待用户验收）
  - [x] 项目信任设置接 Pi trust.json，展示/授予/撤销及目录继承；worker 和 skills 发现共用信任决定，未知/拒绝项目不加载项目配置与 skills，AGENTS 保留。（36 项集成＋4 项信任单测；视觉待验收）
  - [x] MCP 全局配置设置接入实际 mcp.json，支持 JSON 编辑/校验/启停/删除；项目配置合并遵守信任状态。（37 项离线回归；视觉待验收）
  - [x] worker 接入 Pi MCP，默认 direct 工具声明；主会话不加载 MCP；正常任务收尾发 session_shutdown 释放连接。（38 项集成，含真实本地 stdio 假服务调用/子进程退出）
  - [x] MCP stdio 取消/退出清理：同时 abort 与 session_shutdown，等待启动中和关闭中会话；Electron before-quit 等待 Supervisor 清理。（44 项离线集成含挂起初始化/调用、主/worker 启动退出；Electron 原生退出待用户验收）
  - [x] MCP 逐工具风险设置、external 提示/审计、irreversible 内门；direct/codemode 均强制，批准后仅向服务器发原参数，项目设置不能降低风险档。（49 项集成＋6 项内门专项；UI 视觉待用户验收）
  - [x] MCP 搜索披露设置：复用 Pi tool_search/deferred，支持服务器默认值、单个原始工具名或通配符覆盖与删除，保留 direct/codemode/hidden；搜索后的调用仍走风险档和内门。（设置 3 项＋生产子集 6 项＋IPC 7 项＋Pi 搜索 36 项；视觉/真实模型待用户验收）
  - [ ] MCP 设置连接诊断与 HTTP/OAuth 边界、项目扩展执行。2026-11-10 用户要求不用传连接状态到任务会话，本批已转向搜索披露，不新增连接状态投影或注入。
- [x] 读后被改检测（mtime/hash）：
  - [x] worker write/edit 写盘前检查，成功 read 及自身写入更新基准；整文件哈希、路径别名、任务续接/重启持久化。（63 项生产集成＋11 项专项；真实供应商行为待用户验收）
  - [x] file_delete 接入同一检查，递归目录中的已读文件与原路径别名均校验；预览不刷新已读基准。（19 项删除专项＋生产链路）
- [x] scope 交叉警告覆盖排队后启动/续接/更新。（25 项定向回归）
- [ ] 构建产物真正隔离或构建串行（仅注入环境变量不算实现；2026-11-10 用户明确暂缓此项，继续其他 TODO，不新增构建队列）。
- [x] worker 逐字上升卡片、选项回答、自动兜底与相同问题幂等；原话代答/选项直达遵守名额，旧问题失效、历史持久保留。（55 项生产离线集成＋7 项问题专项；视觉与真实模型行为待用户验收）
- [x] 后台作业与流式 worker 按任务去重占位，等待期间不催汇报；已占位任务可追加原话，完成空闲唤醒或忙时 steer。（4 项作业生产链路回归）
- [x] 用户续接/回答/追加优先且最多借一个名额，系统唤醒与首次派发不借用；初始化/worker 连续 10 分钟无事件中止重试一次，再次超时 stalled/failed 并唤醒主 agent；后台作业豁免、前台输出刷新、服务不豁免。（调度 5 项、watchdog 11 项、快照 8 项及生产回归；第三方调用无法中止时的最终关闭边界仍另列）
- [x] 中继持久队列、至少一次投递、relayId 幂等与失败恢复；报告源事件补入队、Pi 上下文消费确认、通知恢复不唤醒、发送失败重试。（60 项生产离线集成＋9 项中继专项；旧版缺载荷/确认的历史不追溯补发，完整事件恢复另列）
- [ ] 完整工具投影、文件/域名/作业/服务访问痕迹、用量与费用、退出码/diff；已有基础工具时间线，shell 改动明确标 unknown。
- [x] 长命令自动转后台、job_output/job_kill、作业结束唤醒、终态/退出清理及重启中断恢复。（8 项作业专项＋4 项生产链路，真实模型与任务页体验待用户验收）
- [x] service_start/stop/status、任务终态保留/续接重启/退出清理/崩溃恢复、真实服务列表、用户停止直连与事件审计。（7 项服务专项＋4 项生产链路＋4 项 IPC；列表视觉待用户验收）
- [x] 服务预览迁移到每标签独立 WebContentsView、统一隔离 partition；真实导航/标题/加载/错误/普通新窗口链接、布局/遮挡/关闭资源和 IPC 归属校验。（11 项替身专项＋4 项 IPC 生命周期；实际 Electron 视觉/窗口验收另列）
- [x] 受控 file_delete：默认 dry-run、完整清单内门、产出/新建文件例外、只读检查、批准后重验、链接不跟随、逐项删除与失败/未执行清单；确认卡展示未提交改动与 cwd 外目标。（19 项专项＋67 项生产集成；真实模型与视觉待用户验收）
- [x] 主会话 git_inspect：动态 cwd、五种只读查询、branch 列表模式、参数允许清单、长输出日志和取消进程树；拒绝修改/输出文件/有歧义的路径分隔符。（26 项专项＋68 项生产集成；真实模型与视觉待用户验收）
- [x] worker git 分档/内门/external 审计与访问投影：结构化 argv、远端配置/强推 refspec、批准后上下文复核、只读边界、仓库范围访问记录。（专项 66/66＋补充 push 子集 4/4，生产集成 71/71；真实模型与视觉待用户验收）
- [ ] 联网检索/抓取/HTTP、GitHub 工具。
  - [x] GitHub issue/PR list/view/create/comment：主只读、worker 外部动作提示/审计、固定 argv 与正文 stdin、仓库主机访问尝试、托管进程及长输出。（离线专项 19 项，真实账号/企业实例待用户验收）
  - [x] fetch_page 正文转 Markdown/分页，worker http_request 六种方法、文本返回/截断；逐跳域名/方法访问尝试，超时/取消/退出终止网络线程。（联网专项 10 项＋任务链路子集 2 项；构建入口 Electron Node 模式验证）
  - [ ] web_search 服务商配置及剩余网络访问投影（按用户收口要求保留待办，暂不扩项）。
- [x] 内门服务：挂起、原话引用校验、主模型判断动作/范围覆盖、上升确认及自动兜底、超时拒绝、取消/退出/恢复失效与独立审计；已接 MCP、file_delete、git 强制点。（真实模型对范围的判断及确认卡视觉待用户验收）
- [ ] 完整审计动作/字段验收：gate/external、手动批准/代答/选项回答/取消已验证；问题 ID、原话依据及按钮归因已补齐，记忆 append/remove 审计已接；未来受控工具及完整字段验收仍待做。
- [x] 简版 MEMORY.md、原话引用工具、每次模型调用动态重读、真实路径/打开编辑设置。（7 项专项＋生产集成增量；明确意图的语义判断由主模型执行，真实模型与视觉待用户验收）
- [x] 每次主模型调用重建任务/问题/内门状态，压缩后与重启后仍有效；chat_search 检索完整主对话、返回可引用原话 ID。（73 项生产集成＋4 项检索＋2 项状态专项；真实模型行为待用户验收）
- [x] 事件流按 UTF-8 字节轮转分段、全局连续 seq 与跨段恢复；短写失败回滚，损坏记录告警、缺段/重复序号拒绝。（8 项专项＋9 项中继＋73 项生产集成）
- [x] 主会话物理分段：20 MiB 或本段新增 10 次压缩；保留最新摘要/近期上下文及 ID，前段只读保留，失败继续原段；自动压缩/启动轮转、中继与跨段引用恢复。（4 项专项＋75 项生产集成）
- [x] TaskStore 快照：每 200 事件/30 秒/退出保存 snapshotSeq 与校验，只从已提交事件投影；缓存加尾部重放，坏/过期/异源快照回退。（7 项专项＋73 项生产集成）
- [x] 状态目录跨进程独占、构造/启动失败释放及退出 IPC 收尾；会话与已受理请求全部结束、快照保存后解锁，关闭失败持锁至进程退出。（6 项锁专项＋3 项 IPC＋78 项生产集成，关闭补丁后相关子集 8/8）
- [ ] 完整恢复流程、孤儿进程清理、优雅中止超时升级进程树终止。
  - [x] 进程宿主先持久登记 PID/精确创建时间再启动命令；主/worker Git 全路径接线，启动恢复先于主会话/调度，取消 5 秒升级、关闭失败持锁，身份不符不杀。（进程 9 项、Git 67 项、只读 Git 26 项；Electron Node 模式构建文件与 ASAR 2 项）
  - [x] worker shell 接入持久登记，作业事实/日志/完成输入恢复；强杀父进程后先清理孤儿，再中断原运行，重启不自动唤醒旧作业。（作业专项）
  - [x] 服务进程登记、业务事件/快照/日志恢复，启动先清孤儿并标记 stopped/interrupted，不自动重启或唤醒。（服务专项及真实父进程强杀生产恢复）
  - [x] MCP stdio 与 env/header 取值命令、主/worker grep/find 及搜索工具准备迁移到登记宿主；取消等待整树清理，启动中关闭不再派发命令，崩溃恢复先于主会话。（MCP 8 项、搜索 8 项、生产 78 项；Electron Node 模式构建文件与 ASAR 各 3 项）
  - [x] MCP OAuth clientSecret 的异步取值命令托管，登录/刷新按需重新读取；取消/关闭等待命令树清理，10 秒超时；已发出的令牌刷新仍保存结果后关闭。（10 项本机 HTTP/真实命令专项，含生产 worker；原 OAuth/连接定向回归）
  - [x] 应用退出及启动失败先启动独立守卫，60 秒收尾后按身份终止应用树；IPC 请求、原生视图/终端、Supervisor 并行收尾，状态锁不提前释放。（退出专项 10 项、主入口 1 项、IPC 5 项；Electron Node 模式构建/ASAR 各 1 项；实际窗口待用户验收）
  - [x] 模型/鉴权配置命令托管：供应商/模型 header、API key、auth.json 请求时解析；列表不执行命令，取消/退出沿登记清理，秘密不写回凭据/登记。（模型配置 9 项＋模型/OAuth/MCP 定向回归）
  - [ ] 退出请求处理前已阻塞、守卫启动失败且主线程阻塞等剩余挂死边界；Windows 核验启动开销优化及其他系统验证。
- [x] xterm.js + node-pty 用户终端：默认 PowerShell、默认工作区/任务 cwd、多标签保留、输入/resize/背压、用户专属 IPC、关闭进程树与主进程崩溃断连清理。（真实 ConPTY＋IPC 专项及 Electron Node 模式/ASAR 验证，视觉待用户验收）
- [ ] 浏览器与终端实际 Electron 验收（服务/公网、键盘/粘贴/选区、浅深色/缩放、遮挡、焦点、退出）。
- [ ] Windows 通知、长路径/编码实测、NSIS 安装包与工作区依赖打包验证、更新。
  - [x] 后台窗口系统通知实现：上升问题/内门、失败/受阻、可关闭的完成提醒；点击前置并定位卡片或只读任务页，恢复不补发、通知句柄有界清理。（8 项通知专项＋6 项 IPC 集成＋1 项主入口退出；实际 Windows 通知及点击体验待用户验收）
  - [ ] 实际 Windows 通知、通知中心点击、免打扰/系统禁用通知以及安装后身份验证；现有 release 安装包尚不含通知增量。
- [ ] 用户图标实际显示验收：桌面/开始菜单快捷方式、任务栏、托盘、安装/卸载界面及不同 DPI。
  - [x] 根目录 icon.png 生成 16/32/48/256 多尺寸 ICO，dev/build 自动生成，窗口/托盘与 Windows EXE/NSIS 配置接入，打包额外携带 PNG/ICO。（托盘替身 3 项＋主入口退出 1 项，真实打包目录 EXE 图标像素/资源哈希核对）
- [ ] 定时任务 worker
- [x] 主/任务对话 CommonMark/GFM Markdown 渲染（静态专项 4 项＋对话回归 5 项；视觉/点击待用户验收，详见验证记录）。
- [ ] 浏览器控制集成、computer use集成（延后）

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

2026-11-10 永续对话状态与原话检索：

- 开始前按用户要求提交当前基线 `978dc62`（95 文件，含根 icon.png）；后续增量未提交。
- rally-state 每次请求从 TaskStore 重建全部未结束任务的 ID/标题/状态/目录/scope/引用/队列/运行与有界最近报告，逐字附未决问题和有效内门，标明等待主模型或用户；附最近 20 个结束任务与名额/审批模式/时间。快照不进入静态提示词或 Pi 历史；worker 不注入。任务清单无 20 条截断，已答/结束/过期门不列为待决。
- chat_search 仅主会话可用，读取事件恢复的完整用户/助手对话，排除系统/中继/流式未完成消息。query 是大小写不敏感的字面匹配，before/after 是不含边界的 Unix 毫秒；按 ID 倒序，默认 20/最多 100，200 字预览；id 全文保留原始空白；aroundId 返回邻近窗口；next 游标配原过滤条件继续。游标固定消息上界，同毫秒不漏页，新消息不挤入旧页。仅用户 ID 能作为授权依据。
- 单文件离线验证：rally-supervisor.test.ts 73/73，rally-chat-search.test.ts 4/4，rally-state.test.ts 2/2。生产覆盖压缩/重启后取旧原话并实际 memory_append 引用、工具循环状态改变、不落盘快照及 worker 隔离。完整构建、最终双端 tsc、diff --check 通过；根 typecheck 仍两个已知模型测试文件错误。无真实供应商或视觉验收。
- 物理会话/事件轮转与快照恢复尚未实现；当前历史仍全量载入内存，检索不是持久搜索索引。总目标继续进行，不能据本批勾选分段/完整恢复。

2026-11-10 事件流分段：

- EventLog 默认 20 MiB 轮转 events-0001/0002…，按 UTF-8 字节计算；单个超大事件独占一段，不拆 JSON 记录。兼容未编号 events.jsonl 和原单文件，按编号加载全部历史；保留旧段，排除临时/备份文件，支持空末段重启。RallyPaths.eventsFile 明确为首段，读者使用 all/ofKind。
- 写入先校验当前段长度，明确偏移同步写；失败截断回原长度，失败事实不发布、不消费 seq。Windows 的 append 模式不能可靠截断，已由故障测试发现并改为 r+；回滚失败使实例拒绝后续写入、要求恢复。独占创建下一段，不覆盖碰撞文件。
- UTF-8/JSON 损坏记录保留并告警；兼容此前被换行隔开的 torn tail。严格校验事件信封与全局连续 seq，缺段/重复或乱序 seq 拒绝启动。只给当前末段补换行，旧段不改。启动通过系统消息显示跳过记录计数/位置。
- 单文件离线：rally-event-log.test.ts 8/8（含真实部分写入＋注入失败、回滚失败），rally-relay.test.ts 9/9（恢复用例强制多段），rally-supervisor.test.ts 73/73（压缩/重启/历史搜索/原话记忆授权用例强制 512 字节轮转）。完整构建与最终应用构建、双端类型检查、diff --check 通过；根 typecheck 最终仅两项已知模型测试文件错误。
- 未真实 API/视觉验收，未新增提交。未声称跨进程锁或断电 fsync 保证；事件仍全量载入内存。TaskStore snapshot、主会话物理轮转、进程恢复及其余 TODO 继续推进。

2026-11-10 TaskStore 快照：

- 新增 task-snapshot.ts，缓存每个任务的最新已提交快照、工具/消息的首次和最新版本（保序）及访问记录；复用 TaskStore replay 构建相同投影，随后仅重放 snapshotSeq 之后的事件。ID 计数从任务/问题历史恢复，访问记录写入到后续 task 快照之间的崩溃窗口仍补 changedFiles。
- 每 200 事件在微任务边界、每 30 秒及 Supervisor 完成会话清理后保存；临时文件 fsync 后替换，保存失败保留事件权威来源并提示，可重试。快照不读取 live TaskStore，未落盘流式内容不进入快照。
- version/snapshotSeq、事件前缀 SHA-256 链及文件载荷 checksum 不匹配时告警并完整重放。EventLog 在读取/追加时计算前缀；旧事件文件无需迁移。修复 TaskStore replay 对 event.data.task/access 的对象别名，运行时修改不再改写内存中的已提交事件。
- 离线单文件：rally-snapshot.test.ts 7/7，rally-event-log.test.ts 8/8，rally-supervisor.test.ts 73/73；生产重启验证实际 loadedSeq > 0，保留跨事件分段、压缩历史原话查询及记忆授权链路。完整 build、双端 tsc、diff --check 通过；根 typecheck 最终仅两个已知模型测试文件错误。
- 当前快照是 TaskStore 重放缓存，事件/主聊天/中继仍全历史内存加载；不删旧事件，不声称启动复杂度或内存已恒定。Pi 主会话物理分段、状态目录锁、完整进程恢复仍待推进；本批未提交、未真实 API/视觉验收。

2026-11-10 主会话物理分段：

- SessionManager.rotateCompactedSession 从最新压缩边界到当前 leaf 保留近期上下文，携带有效模型/思考设置及 custom metadata，保持原 entry ID；重连 parentId 后验证完整 SessionContext 相等。新段独立文件临时写入/fsync/rename 发布，失败不切换 manager、不改旧文件，可重试；header.parentSession 指向前段，segmentCompactionId 防同摘要重复轮转。
- MainAgent 默认文件达 20 MiB 或本段新增 10 次压缩后轮转；启动、成功手动/自动压缩和回合收尾检查。尚无新的摘要则等待下一次压缩，不额外发起模型调用；20 MiB 是触发阈值而非文件硬上限。沿用会话对象保留待送中继，成功记录 segment_rotated；UI 历史、检索和原话引用继续由跨段 EventLog 保持。
- 离线单文件：rally-session-segments 4/4，SessionManager file-operations 35/35、build-context 16/16，生产 Supervisor 75/75；追加轮转事实后相关子集 2/2。覆盖发布失败重试、空保留区间/连续分段、上下文编辑及 metadata、自动压缩期间待送通知、启动按大小分段、重启查旧原话并实际授权 memory_append。完整 build、最后事件补丁后的应用 build、双端 tsc、diff --check 通过；根 typecheck 最终仅两个已知模型测试文件错误。
- 本批无真实 API/视觉验收、无新提交。事件与聊天仍全量载入内存；状态目录跨进程锁、完整恢复、孤儿进程清理与优雅中止超时仍待实现。

2026-11-10 状态目录独占与生命周期：

- StateDirectoryLock 使用运行时内置 node:sqlite，在 state/writer-lock.sqlite 保持 BEGIN EXCLUSIVE；数据库不存业务数据，事件/快照仍按原文件格式。按真实目录解析，junction 别名互斥；不靠心跳时间判断存活，不删除/替换锁文件，不增依赖。进程退出由 OS 释放，坏锁文件保留并拒绝启动。
- Supervisor 在 EventLog 读取/修尾、任务恢复及内门失效之前拿锁；构造中断清除半建 snapshot timer/订阅并解锁，异步启动异常完成 dispose。正常退出等主/worker 会话及已受理 IPC 请求全部收尾，再保存快照、关闭事件写入和释放锁；event/audit/snapshot 旧引用不能继续写盘。会话关闭错误向 Supervisor 汇总，清理失败保留锁到进程退出。
- IPC 注册返回可重复调用的 stop：移除 handler/listener、拒绝新请求并等待已受理请求。Electron 同时启动会话关闭与请求收尾，避免等待停止/压缩请求造成关闭互等；启动异常明确提示并退出，smoke 路径也遵守状态锁。两条旧回归里同时保留可写 Supervisor 的伪重启改为真实关闭后重建。
- 离线：锁专项 6/6（真实子进程四方竞争、阻塞事件循环、强制终止后立即恢复、junction/独立目录、损坏文件、关闭失败持锁、项目自带 Electron 以 Node 模式互斥）；IPC 专项 3/3（已受理设置写入、停止请求与会话关闭、失败注册/请求清理）；生产 Supervisor 78/78，关闭错误补丁后相关子集 8/8；快照 7/7、事件 8/8。完整 build、最终应用 build、双端 tsc、diff --check 通过；根 typecheck 仅两个已知模型测试文件错误。
- 子进程测试不继承 API 密钥，仅用隔离目录；未真实 API/浏览器/截图/Electron UI 验收。实际窗口退出和启动错误框待用户验收。本批未提交。后台作业/服务、持久 PID/创建时间登记、孤儿清理与优雅关闭超时仍未实现；不能据状态锁标记完整恢复完成。

2026-11-10 进程登记与 Git 生命周期增量：

- 新增 ProcessRegistry/ProcessIdentity/独立 process-host 构建入口。先登记独立隐藏宿主的 PID 与精确创建时间，fsync/rename 成功后再下发命令；环境经 IPC 传递，不进入 processes.json。主 git_inspect、worker git 及其仓库预检全部使用同一管理器。
- Windows 核对使用 UTC ticks，核对和 taskkill 间保持进程句柄；PID 不符/消失只记跳过，包含复用为当前 Rally 的 PID。取消、退出及恢复先温和终止，5 秒后升级强杀；正常完成立即回收宿主树。恢复在主会话/任务中断恢复/调度之前执行。taskkill 非零、事实写失败或登记写失败均保留恢复证据；清理失败禁止新命令且退出持锁。
- 隐藏宿主在 Windows 也 detached，防止 Node 父进程 Job 在崩溃时只杀根、遗留原生后代。已有命令的宿主断联后保活并排空管道，供下次按身份清理；未下发命令则自行退出。独立只读 Git 探测并行且 allSettled 收齐，审批前后仍重新核对全部原有指纹字段；Windows 身份检查仍有启动开销。
- 单文件验证：在 packages/coding-agent 下分别运行 node ../../node_modules/vitest/dist/cli.js --run test/suite/rally-processes.test.ts（9/9）、rally-git.test.ts（67/67）、rally-git-inspect.test.ts（26/26）、rally-supervisor.test.ts（最终 78/78）。生产断言检查主/worker 的 process_stopped 事实，含批准前后核对与错误退出码；Git 等待窗口适配真实进程核验耗时。
- 进程专项含真实父子树、UTF-8 大输出、登记先于执行、预取消/不存在可执行程序、写盘失败禁止执行、PID 身份不符不杀、坏文件保留、退出取消、事实写失败后的恢复、父进程强杀后在 Supervisor 主会话启动前清理。独立夹具环境不继承 API 密钥。
- 完整 npm run build 与最后应用构建、node/web 独立 tsc、git diff --check 通过；最终 npm run typecheck 只有已知两个模型测试文件错误。另用项目 Electron 的 Node 模式验证构建宿主及 ASAR 内宿主执行/崩溃恢复，2/2 通过，脚本保留在本机 .artifacts/process-lifecycle/check-electron.mjs。
- 无真实 API、无浏览器/Electron 视觉验收、无新依赖或新提交。NSIS 安装包/实际窗口退出待用户验证；Linux 分支尚未实测，macOS 明确不支持精确身份查询。shell/MCP/grep/find 尚未迁移，主动脱离可发现父子链的进程不保证回收；作业/服务、完整孤儿覆盖及挂死会话退出不因此完成，继续按 Q14 推进。

2026-11-10 后台作业增量：

- worker 的 bash/powershell 改用 JobManager 与登记宿主。默认前台 30 秒，全局 agent/settings.json 的 jobs.foregroundSeconds 可设正数至 3600（无设置 UI）；超时只返回后台 ID/当前输出并解除工具取消归属。显式 timeout 到期立即强杀，普通 job_kill/终态/退出按 5 秒升级。保留 Pi shell 选择与 binPath、stdin 传输、cwd/RALLY 环境及 UTF-8；拒绝开头的等待轮询命令。
- 全量 UTF-8 输出独立写 state/jobs/J-n.log，内存/工具返回有界，结束附尾部最多 200 行。job_output 立即读状态，tail 默认 200、范围 1–2000；job_kill 等待真实进程树停止，均只允许本任务。失败启动、退出码、耗时与日志路径如实返回。
- Task.jobs 保存业务事实，ProcessRegistry 仅保存可验证进程身份。job_started/backgrounded/exited 事件先提交再发布；job_done 按 jobId 去重。完成空闲唤醒/忙时 steer，不另建任务或运行；同任务的多个作业与模型只占一个名额，等待作业不触发忘记汇报提醒。files 增加 job 访问，cancel.killedJobs 返回实际数量。
- 终态和退出清理不唤醒。启动先清理登记进程，未结束作业记 killed/interrupted，再恢复任务中断；已结束作业的缺失完成输入可补记，重复恢复不重新通知中断作业。快照保留作业元数据，输出不进入快照；日志文件参与 ID 计数，避免登记前崩溃后撞号。事实写入失败不会污染 live 作业/输入；清理失败继续保留恢复记录与状态锁。
- 定向离线：rally-jobs.test.ts 8/8、rally-job-supervisor.test.ts 4/4、rally-supervisor.test.ts 78/78。前者覆盖真实进程、超时/取消/归属、输出与快照、写入失败及父进程强杀后的生产恢复；后者覆盖名额、原话追加、忙时 steer、终态不唤醒与实际 killedJobs=2。原进程专项 9 项及新增 stdin 1 项分别通过。完整 build、最终应用 build 与独立 node/web tsc 通过；根 npm run typecheck 最终仅两个已知模型测试文件错误。
- 无真实 API、无视觉验收、无新依赖、无新提交。用户待验收：真实模型按提示等待作业且不轮询、长作业完成继续处理、取消/任务页体验与实际应用退出。服务管理、额外名额、卡死检测、完整访问投影和其他进程迁移继续保留，下一项 service_start/stop/status。

2026-11-10 服务生命周期与列表增量：

- service_start/stop/status 接入生产 worker，服务以 S-n 独立登记并使用同一进程宿主身份核验。start 支持 cwd/env/port/readyPattern，默认 PowerShell/Bash，最多等 30 秒；显式端口启动前检查占用，缺省从输出识别 localhost/127.0.0.1 的端口及 http/https。就绪依据为本机端口监听或输出匹配，不保证端口与进程原子归属；超时返回真实 running/ready=false。PID 是进程树宿主，输出有界并附完整日志路径。
- readyPattern 语法先检查、执行置于独立 Worker thread；最多匹配最近 8192 字符，每次 1 秒截止，复杂正则超时终止匹配线程并返回 error，不阻塞主事件循环、不擅自停服务。服务停止/就绪/退出均关闭线程。env 不进入持久服务元数据，日志与普通工具参数仍按实际记录。
- 服务元数据通过 service_started/updated/exited/stopped 先落事件再发布，随 Task.services 快照恢复；日志文件参与 ID 计数避免孤儿日志撞号。任务 ready/failed/cancelled 不停止已启动服务，不占名额或唤醒；取消启动前阻止执行、启动后取消 worker 只结束就绪等待。续接可查上次服务并显式 stop/start。退出/恢复按进程树核验清理，重启标 stopped/interrupted，保留历史输出。
- shared/ipc 新增服务列表/停止/推送，用户直接停止先写审计与 stop 事件，再等终止确认，不改变任务。主对话显示完成通知，每轮动态状态含运行与最近结束服务。task_read services 分页、worker 只限本任务，上游 card 过滤服务详情；files 增加服务 ID。
- 工位与浏览器起始页使用真实 LocalServices，保留原型卡片/token，展示任务/端口/状态及停止/预览按钮；删除假服务和假本地页面。预览暂沿现有 iframe 载入真实 URL，加载指示读 onLoad；WebContentsView 与完整导航/隔离另列未完成。
- 离线单文件：rally-services 7/7、rally-service-supervisor 4/4、rally-ipc-lifecycle 4/4、rally-processes 10/10、rally-job-supervisor 4/4、rally-supervisor 78/78。最后归属/端口检测补丁后服务相关 2/2。覆盖真实 HTTP、输出、归属、审计/事实失败保护、快照与编号、正则阻塞隔离、取消等待、完成释放名额、续接替换、父进程强杀恢复及 IPC 用户停止。Electron Node 模式匹配线程与构建宿主服务生命周期 2/2，证据 .artifacts/service-lifecycle/check-electron.mjs 不入库。
- 完整 npm run build、最终应用构建、node/web tsc 及 diff --check 通过；根 typecheck 仅两个已知模型测试错误。未调用真实 API、未视觉验收、无新依赖/提交。用户待验收真实模型使用服务工具、列表/停止/预览/实际窗口退出；下一步按 Q20 落实 WebContentsView，不能把临时 iframe 当最终产品。
- 最后补验输出先匹配就绪、端口稍后出现的服务：URL 继续更新，真实 HTTP 用例 1/1 通过。依 05 分册移除模拟书签/星标，最终应用构建和双端检查再次通过；根检查仍仅已知错误。

2026-11-10 原生浏览器增量（Q20）：

- BrowserManager 为每个右栏标签建立 WebContentsView；共用独立持久 partition，无 preload/Node/Rally IPC。新增浏览器声明通道，校验宿主主 frame 和窗口归属，远端页无法调用这些通道。宿主移除 iframe，CSP 禁用 frame/object。
- Chromium 提供真实导航历史、页面 URL/标题/加载状态；起始页保留真实服务列表，HTTP/HTTPS 新窗口链接转右栏标签，支持外部打开、停止和错误重试。修正旧导航失败覆盖新页、失败后重试旧成功页的问题。下载/未开放权限/新窗口 POST 给出系统浏览器提示，不承诺复杂 popup/OAuth 兼容。
- 渲染层同步可见区域、滚动、父层裁剪、缩放；菜单/面板/抽屉/拖动/设置/右栏收起隐藏原生视图，切换保留页面。窗口重载/崩溃/关闭、标签关闭与退出显式关闭 child webContents 并等待销毁；页面自行关闭会同步删除右栏标签。
- 参考适配 electron-browser-shell 的 tabs.js 生命周期，2026-11-10 核实根 MIT，保留版权声明并加入打包清单；未集成其不同许可证的扩展包。05 分册记录来源、隔离、功能边界和官方 API 依据；无新依赖/lockfile 改动。
- 单文件 rally-browser 11/11（Electron 替身、harness，无真实网络/UI），覆盖隔离、归属、导航、布局/缩放、弹窗/权限/下载、过期回调、销毁等待和实际 registerIpc 接线；已有 rally-ipc-lifecycle 4/4。最终 node/web tsc 和应用 electron-vite build 通过；根 npm run typecheck 仍仅两个已知模型测试文件错误。未改 package 生产代码，本批未重复完整 package 构建。
- 实际 Electron 服务/公网预览、焦点/快捷键、浅深色/缩放/遮挡/关闭仍由用户验收；没有启动 UI、没有真实供应商调用、没有新提交。用户终端仍待实现，Q20 总体未验收；其余 TODO 继续推进。

2026-11-10 用户终端增量（Q20）：

- TerminalView 删除模拟文件系统/命令输出，换成 xterm.js 与 fit/web-links/search/unicode11。默认优先 PowerShell 7、否则 Windows PowerShell；默认工作区/任务目录由主进程取值，任务页新增打开终端入口。搜索、Ctrl+Shift+C/V、Ctrl+C、HTTP/HTTPS 链接外部打开及尺寸适配接实际终端。主面板在设置页隐藏而非卸载，保留会话；原型 bg-term/fg/accent 和间距沿用。
- 独立隐藏 terminal-host 加载 node-pty，先核验宿主 PID/创建时间再启动 shell，关闭确认整树回收，失败留标签可重试。shell 退出后宿主保留根便于清理后代；UI 重载/崩溃/退出清理，应用强杀断连由宿主自清。启动取消包括命令已发、native 尚未 ready 的等待；无持久终端历史/自动恢复。
- 用户终端仅所属窗口主 frame IPC 可读写；不提供给 agent、不写 TaskStore/业务审计/聊天。宿主高低水位与 xterm 回调序号确认控制背压，16 标签/5000 回滚行，输入分片不拆 emoji 代理对。实际 UI 由用户验收。
- 新直接依赖全部精确锁定：node-pty 1.1.0，xterm 6.0.0，fit 0.11.0，web-links 0.12.0，search 0.16.0，unicode11 0.9.0；安装使用 --ignore-scripts。原包 MIT 与 Tabby 会话/官方流控参考来源已核实并保留说明；node-pty 整包原生辅助文件 asarUnpack，无新增 rebuild。
- 最终单文件 terminal-session 8/8，terminal-ipc 6/6，browser 11/11，既有 IPC lifecycle 4/4。真实 ConPTY 验证中文/emoji、真实 PowerShell cwd、resize/Ctrl+C、512KB 输出背压、退出码、启动取消/失败、关闭整树、父进程强杀清理；Electron Node 模式验证构建和 ASAR 宿主加载预编译模块及中文往返，2/2，最终补丁后再验证 2/2。
- 完整 npm run build、最后应用 build、node/web tsc、diff --check 通过；根 typecheck 仍仅两个已知模型测试文件错误。无真实 API/视觉自动化/新提交。用户待验收交互式 shell、选区/粘贴/IME、快捷键、浅深色/缩放/焦点、标签保留/退出，以及实际 NSIS 安装。旧版 Windows 回退及主动脱离父子链/权限改变的进程不保证覆盖。下一项继续额外名额/卡死检测或完整进程管理。

2026-11-10 调度优先级与卡死恢复增量：

- Scheduler 统一接纳新运行和空闲 worker 输入，用户回答/追加/续接优先于系统输入和首次派发；同类按待送输入时间、首次按批准时间排序。全局最多 limit+1，额外一个仅用户续接可借，首次运行前追加不借。流式、作业与异步启动预留按任务去重；预留按具体 run 释放，已结束初始化不永久占名额，旧 Promise 晚到不误删新预留。
- WorkerManager 每秒以单调时钟检查无活动时长，所有 Pi 会话事件及前台 shell 输出刷新；仅已后台化的运行作业豁免，结束后给满新 10 分钟。即使前台窗口调至一小时，无输出命令仍可被中止；常驻服务不豁免 worker。空闲/待批准不检测，异步资源/会话初始化也纳入检测。
- 第一次连续 10 分钟无事件先记录 run_stall_retry 和 stallRetries=1，等待当前轮 abort 完成后向同一会话/运行/原模型发送 03 §5.9 原文及未送输入。计数随事件/快照保存，每 run 一次，显式续接的新 run 重置。第二次超时 system 失败报告、endReason=stalled、任务 failed，沿持久中继唤醒主 agent；合并窗口维持原 2 秒。
- 中止或初始化没有返回时不创建重叠调用，另等 10 分钟判失败并释放名额；取消/退出阻止重试，晚到结果不能复活任务。无法关闭的第三方调用仍可能阻塞最终 dispose；不据任务终态宣称完整进程/关闭恢复完成，相关 TODO 保留。
- 单文件定向验证：rally-scheduler 5/5、rally-watchdog 11/11、rally-snapshot 8/8、rally-jobs 8/8、rally-job-supervisor 4/4、rally-service-supervisor 4/4、rally-supervisor 78/78。调度最后修正后生产子集 10/10；前台输出最后修正后 watchdog、jobs、job-supervisor 已按上述数量复跑。使用 harness/faux、可控时钟及真实本地进程，无实际 10 分钟等待、无真实供应商调用。
- 完整 npm run build、最后应用 build、node/web tsc 与 diff --check 通过；最终 npm run typecheck 仅 packages/ai/test 中已知的两个模型数据测试文件报错。无新依赖/新提交/视觉自动化。用户待验收真实模型无活动后继续工作的行为、失败转述和任务页体验；MCP/grep/find 完整进程管理、所有关闭挂死边界及其他清单项继续推进。

2026-11-10 MCP 与搜索进程托管增量：

- MCP stdio 改由 ProcessRegistry.open + PipeTransport 接线，宿主先登记 PID/创建时间才下发命令；双向 stdin 采用 native pipe 背压，输出保留 UTF-8，Windows .cmd 用 cross-spawn 保持参数边界。关闭等待启动中/已运行树清理，登记后的取消不再启动命令；普通 EOF、挂起初始化/调用、忽略 EOF 的后代及崩溃恢复均覆盖。
- McpTransportFactory 支持异步和 shutdown signal，工厂晚返回先关闭 transport；env/header 的 !command 改为托管 shell 执行，10 秒截止、1 MiB 输出限制，结果不写进程登记。Windows 无 Bash 时回退 cmd。HTTP 沿用原 authProvider；OAuth clientSecret 等剩余配置命令仍未迁移，完整 HTTP/OAuth 验证不据本批完成。
- 主/worker grep/find 注入可选 SearchExecution，原参数、解析、忽略规则、glob/context/截断继续由 Pi 处理。取消/结果上限等待整树停止。文件查找避免主进程直接执行版本探测；缺失二进制的探测/下载/解压由新构建入口 search-tool-host 置于登记树内。离线测试 PI_OFFLINE=1，未执行真实下载。
- 最终按单文件验证：rally-mcp-processes 8/8、rally-search-processes 8/8、packages/mcp 的 pipe 16/16、agent-session-mcp 52/52、rally-supervisor 78/78、rally-processes 10/10、rally-job-supervisor 4/4、rally-service-supervisor 4/4。tools.test.ts 仅 grep/find 子集 23/23（88 跳过）；原安全测试的 Windows 绝对路径被当正则，增加 literal=true 保留其参数注入验证目的。
- 生产完整回归初次出现 10 秒清理钩子超时及下一例临时目录占用；改为 30 秒并隔离每例目录，allSettled 收齐关闭错误、失败保留证据，随后单文件独立完整 78/78。遗留测试宿主已核验 PID/创建时间及原父进程状态后清理，不隐去该失败记录。
- Electron Node 模式构建宿主与 ASAR 各验证 MCP 崩溃树恢复、.cmd 参数及中文通信、离线搜索 helper，共 6/6；证据 .artifacts/mcp-search-lifecycle/check-electron.mjs 为本机忽略文件。完整 npm run build、node/web 独立 tsc 通过；根 npm run typecheck 仅两个已知模型测试文件错误。
- 新直接精确依赖 @rally/mcp 1.5.0、cross-spawn 7.0.6、@types/cross-spawn 6.0.6，使用 npm install --ignore-scripts，未跑生命周期脚本。无新提交、真实供应商调用或视觉验收。真实外部 MCP、在线下载、实际窗口退出/安装包、非 Windows 平台及脱离父子链的进程仍未验证；完整恢复和所有关闭挂死边界保留 TODO。

2026-11-10 MCP OAuth 配置命令增量：

- 新增可注入 McpConfigValueResolver，Rally 的生产 worker 将 OAuth clientSecret 与 env/header 接到同一受管命令解析。密钥在登录/刷新需要时异步读取，每次重新取值；10 秒超时、1 MiB 输出限制，取消等待整树退出，取值结果不写 processes.json。
- oauthSettings 返回 Promise 并跟踪未完成的解析，合并单次取消与连接关闭信号；扩展登录把读取包含在 track 中，CLI 截止也包含设置读取。关闭发生于读取阶段时不开回调/浏览器、不发 token 请求；已经发出的刷新继续等待并保存轮换结果，保留 Pi 的凭据持久规则。
- 新专项 rally-mcp-oauth 10/10：本机 HTTP OAuth 服务、真实命令/子孙树、harness/faux；覆盖按需登录、密钥文件更新后刷新、取值/刷新过程中关闭、真实 10 秒超时、扩展登录关闭、单次取消后再次解析、已发刷新迟到令牌保存、生产 worker 成功与取消/进程归属。原 agent-session-mcp-oauth 10/10、mcp-oauth-refresh 16/16、mcp-extension 28/28（1 项原有 Windows 跳过）、packages/mcp oauth 14/14、agent-session-mcp 52/52、rally-mcp-processes 8/8、生产 MCP 子集 11/11（67 跳过）。均按单文件运行，无全量 Vitest。
- 初次原 OAuth/配置回归因旧测试写死 .pi、Pi 名称与默认 Pi 元数据文档失败。改用 CONFIG_DIR_NAME/APP_NAME；显式 CIMD 用例保留，新增自动注册按构建身份验证。没有改变 Rally 不是官方 Pi 的产品行为。
- 完整 build、node/web 独立类型检查、diff --check 通过；最终根 typecheck 仍仅两个已知模型数据测试文件错误。无新依赖/新提交、真实供应商请求、外部登录、浏览器或 Electron UI。Rally 设置页 OAuth 登录与连接状态、其他模型/鉴权取值命令、任意第三方会话挂死关闭等仍是待办；本机测试不等同实际外部服务兼容验收。
- 最后补验持续超量配置输出：触发 1 MiB 上限后丢弃后续块，避免等待终止时内存继续增长；OAuth 专项最终 10/10，最后应用构建及双端类型检查通过，根检查仍仅已知错误。

2026-11-10 应用退出守卫与新会话交接：

- ApplicationShutdown 统一退出与启动失败；先确认独立 shutdown-guard-host 就绪，再启动收尾。IPC 停止受理后并行等待已有请求、原生浏览器/终端及 Supervisor 清理，避免请求挂起阻止其他资源回收。重复退出只执行一次；启动失败通知异常仍执行清理并汇总错误。
- 独立守卫默认 60 秒后核对主进程 PID/创建时间并强杀应用树；正常完成取消守卫，终止已开始则不再取消。主进程保留 75 秒本地异步兜底。状态锁不提前释放，正常完成保存快照，错误持锁到退出；重启按已有登记及事件恢复 interrupted。
- 此上限只用于应用退出，不改变 Q12 单任务无上限。正常关闭保留已发 OAuth 刷新的落盘等待；强制退出可能打断尚未完成的凭据/其他写入，不承诺全保存。守卫未就绪、退出请求处理前已阻塞、权限变化/脱离父子链、非 Windows 平台等边界继续留待办。
- 最终单文件：rally-application-shutdown 10/10、rally-main-shutdown 1/1、rally-ipc-lifecycle 5/5、rally-terminal-ipc 6/6、rally-browser 11/11；生产 Supervisor 退出/启动/锁子集 14/14（64 跳过）。真实隔离进程覆盖 Promise 挂起、同步死循环、启动失败、正常退出、全树回收、持锁及生产恢复；主入口使用 Electron 替身，无 UI 和供应商请求。
- 最终构建及 ASAR 的 Electron Node 模式验证各 1 项通过，证据 `.artifacts/shutdown-lifecycle/check-electron.mjs` 不入库。应用 build、node/web tsc 通过；根 typecheck 仅已知两个模型测试文件错误。新主入口测试引出的 NodeNext 相对导入扩展名错误已修复并复验。未改 packages 生产代码，本批没有重复完整 packages 构建。
- 用户要求更新交接后转新会话继续，随后要求提交；本次将前置提交 978dc62 之后的累积增量与文档一起提交。下一会话以 HANDOFF 顶部为入口，建议先处理其他模型/鉴权配置命令托管；实际窗口退出、错误框、安装包和视觉验收继续由用户负责。

2026-11-10 Markdown 渲染增量：

- 主/任务对话的 RichText 从原型正则替换为 react-markdown + remark-gfm；保留原型 token、段落间距与只读任务界面。支持 CommonMark/GFM 常用结构、表格/代码滚动及流式未闭合围栏。
- HTML 转义；仅无凭据绝对 HTTP(S) 链接可打开右栏，图片点击查看，不自动联网加载；原话/提问/内门字段仍逐字展示。相对文件跳转、公式/图表、代码高亮与内联图片不在本批范围。
- 新静态专项 4/4、原对话渲染回归 5/5；应用构建、node/web tsc 通过；根 typecheck 仍仅两个已知模型测试文件错误。无全量 Vitest/真实 API/UI 自动化。新增精确开发依赖 react-markdown 10.1.0、remark-gfm 4.0.1，使用 --ignore-scripts。
- 视觉、长内容滚动及点击交互待用户验收。其他模型/鉴权配置命令托管尚未实施；本批不勾完完整恢复或 UI 总验收。


2026-11-10 模型配置命令托管增量：

- ModelRuntime 注入可选 ConfigValueResolver，供应商 API key/header、模型 header、兼容无鉴权 header 和存储命令密钥均走请求时异步解析。AuthStorage 的保留命令模式与 provider check 保证列表不提前执行；原凭据内容不替换为命令结果。OAuth header 取消信号已传递，刷新保存行为保留。
- Rally ModelStore 接 ProcessRegistry；共用 MCP 的命令执行器，10 秒/1 MiB，应用级 kind=config、agentDir cwd，无命令/输出持久登记。取消或关闭等待已有登记清理，新调用在关闭后拒绝。
- 新 rally-model-config.test.ts 9/9；model-registry 89/89、model-runtime-credential-sync 10/10、ai oauth-auth 13/13、MCP 进程 8/8、MCP OAuth 10/10。完整 build、node/web tsc 通过；根 typecheck 仅既有两个模型测试文件错误。无全量 Vitest、真实供应商、UI 或本批 Electron/ASAR 专项；无新增依赖、未提交。

最终补验：环境变量展开后以 `!` 开头的凭据仍按字面量传递，避免二次命令求值；模型配置专项最终 9/9，最终完整构建通过。


2026-11-10 应用图标与 Windows 打包增量：

- 用户明确暂缓构建产物隔离/串行，问答 Q2 和 TODO 已记录。新增图标生成脚本和精确开发依赖 png-to-ico 3.0.2，安装 --ignore-scripts；根 icon.png 自动生成 16/32/48/256 ICO，保持原图。窗口/托盘与 Windows EXE/NSIS 安装/卸载均接线，运行时 extraResources 携带两种资源。
- 托盘显示/恢复及退出走既有 app.quit/守卫；关闭主窗口仍退出。rally-branding 3/3、主入口退出 1/1，单文件离线替身，无浏览器或 Electron UI。应用构建、node/web tsc 通过，根 typecheck 只报两个已知模型测试文件错误。
- electron-builder Windows x64 --dir 与 NSIS 成功，明确禁用依赖 rebuild（持久配置 npmRebuild=false），未签名、发布、运行安装器。release/Rally-0.1.0-setup.exe 为 138495593 字节。EXE/安装器内嵌 32px 图标与生成 ICO 逐像素一致（0 差异）；打包 PNG/ICO 哈希一致；ASAR 主/helper/工作区入口存在。安装/卸载、完整打包运行、Windows 快捷方式/任务栏/托盘及不同 DPI 的视觉仍待用户验收。


## 系统通知增量（2026-11-10）

- TaskNotifications 接生产 Supervisor 任务事件，后台窗口提醒上升问题/内门、失败/受阻及完成；完成开关默认开启，经声明 IPC 和主窗口主 frame 校验持久化。恢复/快照/前台事件不补发，连续受阻去重，解决/取消/退出撤回旧通知；原生句柄最多 32 个，保留 Windows 通知中心的延后点击能力。
- 点击前置窗口，问题/内门定位主对话原卡片，完成/失败/受阻打开只读任务页。通知定位暂停自动跟随；回到底部/发送后恢复。修正 openTask 误选同任务终端标签，以及 StrictMode 重订阅期间首次异步消费被丢弃的边界。
- 定向离线：rally-notifications 8/8、rally-ipc-lifecycle 6/6、rally-main-shutdown 1/1。通知专项覆盖启动去重、上升条件、前台抑制、超时后点击、设置持久化、失败/受阻、取消与 dropped、不支持/抛错、句柄上限和旧回调。新增 IPC 用例用真实 Supervisor 生成问题/完成事件，核验主 frame 权限、点击目标只消费一次和设置落盘；测试首次补齐 Electron app.getAppPath 替身后通过。
- 应用 electron-vite build 与独立 node/web tsc 通过；根 npm run typecheck 最终仅两个已知模型数据测试文件错误。无新依赖、真实 API 或 UI 验收，不重复 packages 构建。当前 release/Rally-0.1.0-setup.exe 仍为图标批次产物，不含本批通知；本次未重新打包/安装。
- 待用户验收：窗口后台/最小化时各类通知，前台不弹；通知中心中已超时横幅的点击，设置页跳回卡片/任务详情、流式期间定位、完成开关重启保留；系统关闭通知/免打扰与安装后应用身份。未实现应用退出后的通知冷启动跳转，退出会主动关闭当前句柄。构建产物隔离/串行继续暂缓，其余 TODO 正常推进。


## MCP 搜索披露增量（2026-11-10）

- 用户要求不用传连接状态到任务会话，改为允许 MCP 工具搜索披露。本批未增加连接状态投影或会话注入。沿用 Pi tool_search 的名称/描述/schema/namespace 检索和 deferred 工具按需加载；不改变主会话只读工具边界，也不改变已有 MCP 风险门控。
- 设置页支持服务器默认 direct/deferred/codemode/hidden，以及原始工具名/通配符规则的新增、修改、删除。精确名称覆盖通配符，通配符依配置顺序取首条；无规则时继承服务器默认，Rally 无显式 exposure 时仍为 direct。写入全局 mcp.json，保留参数、未知字段与风险配置；受信任项目的覆盖保持原规则。当前会话不热重载，新建/续接时读取。
- 定向离线：rally-mcp-settings 3/3（持久化/字段保留/规则优先级/非法输入/项目覆盖），rally-ipc-lifecycle 7/7（含新设置通道的主 frame 权限和实际落盘）；生产 rally-supervisor 6/6，75 跳过（总 81），只跑 MCP 配置、逐工具披露和 direct/codemode/deferred 门控。真实本地 stdio + faux 验证首次请求无 deferred 工具，tool_search 命中后加入下一请求，hidden 工具不被搜出，不可逆调用在批准前未到服务器、批准后只传原参数。原 Pi tool-search 36/36。
- 应用构建与 node/web tsc 通过，根 npm run typecheck 仍仅两个已知模型数据测试文件错误。无新依赖、packages 生产源码修改、真实外部 API 或 UI 验收；未重新打包，旧安装包不包含系统通知和本批设置。
- 待用户验收：MCP 列表中的默认披露选择、规则增改删、JSON 往返、浅深色和窄栏；真实任务模型是否合理搜索并调用。逐工具规则输入服务器原始名字（如 search_issues），风险档仍用已发现的完整 mcp__ 工具名；连接状态/OAuth 操作及项目扩展仍未勾完。


## GitHub 工具增量（2026-11-10）

- 主会话 github_read 限 issue/PR list/view，worker github 提供 list/view/create/comment；使用本机 gh 的当前登录。参数固定、无 shell；正文 stdin 原样传输。repo 省略时按 cwd 解析后固定，显式 OWNER/REPO 固定 github.com，也支持 HOST/OWNER/REPO；忽略 GH_REPO/GH_HOST 继承覆盖。PR 创建要求显式已推送 head，避免隐式 push/fork；用户原话授权由既定提示词约束。
- 外部动作执行前写 attempt 审计并提示，记录任务/运行/调用和正文 SHA-256/字节数；非零/取消为 unknown，不自动重试。worker net 访问仅表示仓库主机尝试，不声称实际 API/proxy 流量或发现请求已完整覆盖。全部 gh 进程纳入登记/整树取消/退出，长输出存完整日志，元数据有界。
- 专项 rally-github.test.ts 19/19；包含真实本地 Node 替身子进程与 harness/faux 生产主/worker：只读边界、全部八种动作、非法参数、正文/参数原样、仓库解析/状态失效、审计失败不执行、非零返回、长输出/元数据上限、取消整树与恢复。首次失败为测试重复 toolCallId 触发正常访问去重，改成唯一 ID 后通过。rally-supervisor 仅角色工具和访问/用量子集 2/2（79 跳过，总 81），未跑完整文件或全量 Vitest。
- 应用 electron-vite build 和 node/web tsc 通过；最终根 npm run typecheck 仍仅两个已知模型测试文件错误。无新依赖、packages 生产代码修改、真实 GitHub/供应商 API 或 UI 验收；未提交或重新打包，现有 release 安装包仍未包含通知、披露和 GitHub 增量。
- 待用户验收：已安装 gh 与登录账号的实际查询、明确授权后创建/评论、企业实例/代理、取消后先查远端状态；本批未做真实发帖。web_search 服务商选型/设置、fetch_page、http_request 和完整网络访问仍未完成。构建隔离/串行及向会话注入 MCP 连接状态不在本批推进范围。


## 网页抓取与 HTTP 收口（2026-11-10）

- fetch_page 已接主/worker：静态 HTML 抽取 Markdown，标题/列表/代码/表格/绝对链接；脚本与子资源不执行，不带浏览器登录。支持文本/JSON/XML，maxChars 默认 20000、上限 100000，offset/nextOffset 按 UTF-16 字符分页并重新抓取。默认 30 秒、解压后 5 MiB、50000 DOM 元素上限，二进制/过大页面明确拒绝。
- worker http_request 六种方法，显式 headers 和原样正文，保留 HTTP 状态/headers/至多 20000 字符正文；默认 30 秒、可配 100–120000 毫秒。GET/HEAD 跟随最多 5 次重定向，跨 origin 丢弃显式 headers；写方法不重放重定向、不自动重试。线程负责网络和解析，超时/取消/退出等待终止；不增加审批门。worker 每跳发送前持久记录域名、method、requestIndex 的 net attempt，失败不发送；不声称实际流量或远端执行必然成功。
- 新增精确生产依赖 @mozilla/readability 0.6.0、jsdom 27.4.0、turndown 7.2.5，类型依赖 @types/jsdom 27.0.0、@types/turndown 5.0.6；均 npm install --ignore-scripts，清单和 lockfile 已核对。无 packages 生产代码修改。
- 最终 rally-network.test.ts 10/10（本地 HTTP＋真实线程＋harness/faux 生产会话）；覆盖正文/编码/分页/方法/状态、跨 origin 头清理、写重定向不重发、错误输入与访问记录存储失败不发包、解压上限、取消/超时/关闭断连、主只读工具边界和重启恢复。首次两项等待过短，已修正为覆盖加载时间并完善失败清理，最终无未处理拒绝。rally-supervisor 仅角色工具/访问用量子集 2/2（79 跳过）。
- node/web tsc、electron-vite build 通过；根 typecheck 仍仅两个已知模型测试文件错误。Electron 45.2.3 Node 模式执行构建 network-host、本地文章抽取通过；本机证据 .artifacts/network-tools/check-built.mjs。未全量 Vitest、真实外部 API、浏览器/Electron 视觉验收、重新打包或提交；release 仍是图标批次旧安装器。
- 用户要求不要过度开发，TODO 差不多即可停止。本批收口后暂停持续目标，保留 web_search/完整网络投影等待办，不继续自动扩项。真实公网/代理/站点兼容和界面体验留给用户验收。

## 实测反馈修复（2026-11-10，不恢复自动扩项）

- [x] 主 agent 可见启用 Skills 名称/摘要，禁止自行读取原文；每次请求刷新临时目录，主 read/grep 拦截技能正文，worker 按 cwd 正常使用。
- [x] 主 agent 获得 MCP 低预算配置摘要：名称、短 description、最多四个已知工具名及适用项目；条目约 2400 字符上限、省略计数，无凭据/schema/连接探测，不向 worker 传连接状态。
- [x] MCP 独立新增/逐项编辑，重复名称保护，保留整份 JSON 编辑；新增主 frame 校验 IPC，保存不连接服务。
- [x] 任务输入投影包含原有持久的 resume/steer/answer 记录，任务页按时间展示原话、备注及投递状态；已结束任务可直接归档/恢复，重启保留，续接自动恢复。
- [x] 连续助手回合的相邻工具调用合并、默认折叠，摘要/图标与间距按原型；已回答/失效问题按时间折叠；统一 Rally 图标，删主对话冗余状态，限制整个主对话横向溢出。
- [x] 整理上下文统一二次确认、进行中全屏模态遮罩、成功后的屏蔽旧会话选择和恢复显示；历史/原话不删除，失败不清屏。
- 离线检查：MCP 设置/预算 5/5、静态渲染/续接投影 7/7、IPC 8/8；`rally-supervisor.test.ts -t 'capability summary|archives only|organizing context|declares Rally roles|cwd skill'` 对应 6 个用例分批通过，目录用例另验证本地 rg 排除技能正文。初次新测试等待不足已修正。应用双端 tsc 和 electron-vite build 通过；根 typecheck 仍为已知两个模型测试文件的错误。
- 本轮开发侧没有启动 UI 验收或调用真实模型/MCP，没有新增依赖或修改 packages 生产源码，未打新安装包。用户随后确认阶段性测试完成，并自行清理临时问题记录和图片；长期清单、实现记录和未完成 TODO 保留。
