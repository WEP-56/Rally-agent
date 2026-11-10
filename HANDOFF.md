# Rally 开发交接（更新 2026-11-10）

> 先读 `docs/开发实施TODO.md` 和 `docs/superagent/00-问答记录.md`。实施进度以 TODO 的验证记录为准；本文保留历史背景，不作为阶段完成证明。

## 当前交接点（2026-11-10，简版 MEMORY 已接线）

- 已读取 TODO、问答记录 Q23 及相关规格，继续完成上一批 MEMORY 草稿。遵守中文、原型样式、不主动视觉验收、单文件离线测试、不提交等规则。工作区仍有多批未提交修改，不要清理或回滚。
- MemoryStore 已接 Supervisor；主会话注册 memory_append/remove，每次模型调用在 transformContext 重读文件（工具循环、中继、压缩后和重启均复用此入口），快照不持久化到 Pi；worker 无记忆工具且不自动注入。
- 宿主核验真实用户消息引用并拒绝 proposal；“明确要求记住/忘掉”的语义覆盖由主模型按提示词判断，不能声称宿主验证了意图。追加最多 300 字，按引用与文本去重；删除需要本轮完整观察的未变条目。审计先于写入，失败/取消不写，写后记录失败明确告知已应用。
- Markdown 支持普通手写内容和旧式仅开始标记（该条目范围限紧随的第一个段落），新条目使用成对结束标记以保留无关手写段落；重复/错配标记报错，请用户修复。memory_changed 只记 entryId/op；专用审计无正文，含原话 ID、操作及前后哈希。普通对话和工具历史仍按已有契约保留用户话语与工具参数。
- 设置/首次引导共用真实 MemoryForm：绝对 .md 路径、选择已有文件、保存、实际大小/条目数/预算、打开编辑及刷新。路径保存到 ~/.rally/memory.json；打开不存在文件才创建，切换路径不迁移文件。移除假统计、自动整理/清空及向量索引文案；工位路径从后端加载。保留原型 token。
- 验证：rally-memory.test.ts 7/7；rally-supervisor.test.ts 首跑 71 通过、1 个新增用例因测试过早检查 busy 失败，修正等待实际回复后该用例定向 1/1 通过（其余 71 未重复跑）；覆盖动态重读、原话工具执行、压缩/重启与快照不落盘，现有派发链路新增 worker 隔离断言。静态渲染 5/5；完整 npm run build 通过，最终 UI 小改后应用构建和双端 tsc 复核通过。npm run typecheck 仍只有两个已知模型测试文件错误。
- 限制：约 2k token 用 6000 UTF-8 字节估算，超限只注入开头并提示用户精简；超大/坏编码文件仍可打开修复。写前重验不是跨进程原子锁；未实现事务性审计恢复。真实供应商语义行为、系统编辑器打开及视觉待用户验收；未调用真实 API、未启动浏览器/Electron、无提交。
- 下一步可推进压缩后的完整任务/问题/门状态重注入，或长命令自动转后台与作业工具；先查问答记录和 TODO。联网服务商等不明确项先查 docs，仍无结论再问。整体审计/恢复、事件分段、进程清理与其余工具仍未完成，勿勾完总项。

## 最新增量（2026-11-09 worker Git 分档与内门）

- worker 已声明结构化 `git({args,cwd})`，只接受内置子命令和参数数组，不接受全局 Git 参数、别名或 shell 字符串。风险规则在 `supervisor/git-risk.json`：reset/checkout/restore/switch/clean、强制/删除/镜像/裁剪 push、branch -D、stash drop/clear、reflog 删除/过期、gc（默认 prune）进入不可逆内门；普通 push/push --tags 为 external；其他项为可逆。
- 分档会解析短选项组合、值和 `--`，识别 `+refspec`、删除 refspec、remote mirror/push 配置、branch.pushRemote/remote.pushDefault、pushurl 与 `insteadOf/pushInsteadOf`，并拒绝远端组、递归子模块和无法核对的语法。内门冻结原始参数；批准后重新读取仓库 identity、HEAD/refs、配置、远端和 pathspec 文件指纹，变化则 `GIT_CONTEXT_CHANGED`。
- 内门 scope 使用真实 cwd、repository/git common dir、脱敏配置远端 URL、refspec 和 pathspec 文件；读取到的配置仅存指纹，配置凭据不写入 gate 或审计。原始模型 args 按工具契约留存。普通 push 先写 external audit 和右栏事实，再执行；执行结束补退出码。Git 访问记录按仓库命令范围记录 fs_read/fs_write，fetch/pull/push 另记解析到的远端主机，明确为 attempt/command_scope，不虚构 changedFiles。
- 只读任务只能查询项目 Git；本地改动只有当 cwd、repository、git/common dir 全部在 outputDir 才允许。shell 中的 Git 仍只做可见性记录，不拦截。worker 提示加入 commit/push 必须有用户原话、不得用 shell 绕过、上下文变化要重新检查。
- worker Git 专项 66/66，最终 push/refspec 修改后子集 4/4（含新增的第 67 项）；生产集成最终 71/71，主会话 Git 专项 26/26。应用双端类型检查和完整构建通过；根 typecheck 仍两个已知模型测试文件错误。后补 --repo 优先级（位置仓库覆盖选项）、checkout 路径和 fetch.all 边界定向复核。未调用真实供应商、未视觉验收、无提交。后台作业/服务、联网 HTTP/GitHub、完整进程树超时和快照仍待做。
- 限制：命令范围不是精确文件 diff；Git hooks/扩展执行和 shell 不构成沙箱，远端访问记录不证明实际网络流量；只读任务的仓库边界不保证任意 hook 无外部副作用。未知控制选项/别名/远端组/递归 push 明确拒绝。检查到执行间仍有外部进程竞争，未实现原子仓库锁；既有配置文件副作用/网络代理等完整投影另留 TODO。

## 最新增量（2026-11-09 主会话 Git 查询）

- 已接入主 agent 的 git_inspect（status/log/diff/show/branch），相对 cwd 随默认工作区变化；参数数组执行、不经 shell，branch 强制 --list。只读选项清单在 supervisor/git-policy.json，未知/缩写/修改参数和 --output 一律拒绝；特别处理前一选项可能吞掉 `--` 的情况，避免误认路径分隔符。
- 新增 git-runner.ts：关闭可选索引锁、刷新、fsmonitor、外部 diff/textconv、自动补取缺失对象及签名辅助程序；清理继承的 Git 重定向环境，禁用 Trace2 目标。保留真实退出码，超过 30k 字符保留首尾并把全文写到 state/tool-output/main，read 可继续读取；日志存储失败不伪报成功。取消等待本次进程树退出。
- 主提示词与工具活动接线，Git 查询沿用搜索图标；工作区切换、拒绝写入及重启后的工具历史已走实际 Supervisor + faux provider。Git 专项 26/26、生产集成 68/68、完整构建与应用双端检查通过；根 typecheck 仍两个已知模型测试文件错误。未调用真实供应商或做视觉验收，无提交。
- 只完成 git_inspect，worker git 风险分档/内门/external 审计及访问投影仍待做。下一步按 02 §3.5 实现：注意 push 的 +refspec、remote.<name>.mirror/push 配置、checkout 路径模式、短选项组合与参数值、批准后配置改动；不能只匹配 --force 字符串。shell 仍非沙箱，commit/push 的用户原话要求按提示词执行。通用 5 秒中止升级与孤儿清理仍未完成。

## 最新增量（2026-11-09 受控删除）

- worker 已有 file_delete，默认 dry-run，返回实际数量/常规文件字节/≤50 预览/未提交/cwd 外清单。实删内门冻结完整 manifest，宿主生成动作、范围和保留文件的替代方案；主模型引用原话批准，或沿用用户上升卡。全部 outputDir 或有 created 访问证据且创建版本匹配的文件免门。
- 只读任务可预览，但实删只限产出目录；别名祖先解析到真实路径，最终 symlink/junction（含悬空）只删链接。版本检查覆盖递归目录和原读取别名，批准后重扫，逐项 unlink/rmdir，绝不递归删除新增子项；失败停止并返回未执行项，取消/终态不再删。
- `file-versions.ts` 增加 capture、创建身份和删除 tombstone；旧记录缺创建身份不推定免门；外部修改后重读也撤销免门资格，合法删除后可再创建。write 对新文件用 wx 确认创建来源。路径辅助函数移入 `file-paths.ts`，write/edit 原只读边界不变。
- TaskAccess 新增 fs_delete；TaskStore 去重键包含 kind/target，逐项删除进 changedFiles 与恢复。文件删除工具活动有对应图标；GateCard 直接展示未提交和 cwd 外清单，保留原型 token，视觉待用户验收。
- 生产离线集成 67/67，删除专项 19/19，版本专项 11/11，静态渲染 5/5；补丁后生产相关子集与 readonly 预览定向复核。完整构建及最终应用构建、双端类型检查通过；根 typecheck 仍两个已知模型测试文件报错。未运行真实供应商/外部 MCP/视觉验收、无提交。临时 Git 夹具仅 init/add，无提交。
- 下一批可推进 git 工具分档与 git_inspect（按 02 §2.1/3.5，注意破坏性参数识别与内门），或简版 MEMORY；先读问答记录及对应文档。一般进程树/孤儿清理、输入 readAt、事件快照分段、联网/作业/服务仍未完成。文件检查不是外部进程的原子锁，不保证崩溃窗口的删除访问日志完整性，不提供回滚。

## 最新增量（2026-11-09 读后被改检测）

- 新增 `supervisor/file-versions.ts`，worker 的 read/write/edit 包装 Pi 默认实现；SDK 仅补导出 createLocalReadOperations，保留流式读取与图片处理。成功 read 记录实际整文件 SHA-256、mtime/文件身份及规范路径；局部读取仍覆盖整文件，失败/取消不更新。
- write/edit 在原有 Pi 文件变更队列内、写盘前校验；IDE/shell/其他任务改写、删除/替换、junction 改指均返回 STALE_FILE。重读后可继续，成功自身写入刷新基准，edit 内部读取也校验；写入前重查任务终态/只读路径。worker 提示禁止用 shell 绕过。
- 基准写入该任务 Pi JSONL 的 custom entry，重启/续接恢复；旧历史不反推，从未读过的文件保留 Pi 行为。没有新增宿主锁，外部程序仍可在检查与写盘之间竞争；shell 读写不被监控。file_delete 尚未实现，TODO 已拆分为 write/edit 完成、删除接入待做。
- 生产离线集成 63/63、文件版本专项 11/11、Pi tools.test.ts 的 read tool 子集 12/12；完整构建、应用双端检查通过，根 typecheck 仍两个已知模型测试文件报错。未调用真实供应商/视觉验收、无提交。
- 下一批可推进受控 file_delete（按 02 §3.4 及 01 §4.4 内门规格）、简版 MEMORY 或剩余资源连接状态；先核对问答记录和 TODO。worker 输入 readAt/恢复、事件快照/分段、一般进程树与孤儿清理仍待做。不要把整体工具契约或整个 TODO 勾完。

## 最新增量（2026-11-09 中继持久化与失败恢复）

- Relay 改为 events 中的持久待发队列，保存完整正文、relayId、源事件和卡片关联；启动按顺序恢复。报告/问题/内门/依赖/中断与按钮通知从源事件补齐，覆盖“事实已落盘、尚未入队”的窗口；约 2 秒合并，忙时旧队列与新报告一起按顺序 steer。
- 修复原 sendCustom triggerTurn=false 并非真正 steer；现用 Pi triggerTurn=true/deliverAs=steer，通知仍 nextTurn。中继消费到模型上下文前不写 delivered；会话 metadata 与系统行携带 relayId 去重。已在历史但缺确认时只发恢复指针，不重复事实正文；压缩移出上下文的未确认载荷会重新注入。
- 发送异常按 1–30 秒退避；模型未就绪保留待发，选择模型后继续；用户停止后未读报告保留到下一轮，不立刻重新唤醒。通知重启恢复但不主动发起一轮，旧问题/内门失效后不补发操作请求。
- Pi SessionManager 的 custom-only 首轮现在也立即创建会话文件；新增 getPendingCustomMessages 供去重。EventLog 先成功写盘再发布内存事件，修复半行尾部导致下一条事件损坏。file-operations 两处写死 pi 的断言改 APP_NAME，Windows 不支持的目录 chmod 故障改为准确路径冲突。
- 生产离线集成 60/60，中继专项 9/9，session-manager 文件回归 35/35、会话持久化 16/16。应用双端检查、完整构建通过；根 typecheck 仍两个已知模型测试文件报错。未调用真实供应商、未做视觉验收、无提交。
- 兼容边界：relay_started 首次启用之后的事实可可靠补入队；旧版仅有 ID、没有载荷/真实确认的历史不追溯重放，避免已处理报告再次触发。至少一次指交给主模型上下文，不承诺供应商成功生成或业务动作 exactly-once。worker 输入 readAt/恢复、事件快照/分段和孤儿进程仍待做。下一步推进读后被改检测。

## 最新增量（2026-11-09 worker 问题闭环）

- escalate 新增 kind=question；主 agent 处理过该问题中继的一轮结束时，未答/未上升的问题自动上升。逐字保留问题（含空白）与选项。相同运行的同文同选项问题复用 ID；已答重报返回原答案，不重复通知。
- 主对话 QuestionCard 支持选项直达 worker，不唤醒主 agent；打字回答仍经主对话 task_answer 引用真实消息。后端校验当前问题/运行及原始选项，流式走 steer，空闲时按名额唤醒。替换、撤回、结束、取消、重启使旧按钮失效。attentionHistory 保存结果；TaskBoard.questions 独立投影全部主对话问题，不受右栏最近 20 个结束任务限制。
- 修复代答先清除问题导致审计丢字段；批准/代答/取消审计先于状态变更，主模型动作保留原话 ID，批准按钮 actor=button、回答/取消按钮 actor=user，按钮 basis=[]，不伪造消息引用。审计失败不消费问题或改变批准/取消状态。
- 生产离线集成 55/55、问题专项 rally-questions.test.ts 7/7、内门回归 6/6、静态渲染 4/4。应用双端检查与完整构建通过；根 typecheck 仍只有两个既有模型测试文件错误。视觉及真实供应商由用户验收，无提交。
- 下一步可推进中继持久化/至少一次投递/失败恢复（目前队列仍在内存），或读后改检测。MCP 连接状态、HTTP/OAuth、任意扩展、受控工具、记忆等仍在 TODO；本轮没有将完整审计或工具契约总项勾完。

## 最新增量（2026-11-09 MCP 风险档与内门）

- MCP 设置支持逐工具风险档，实际发现的工具名缓存于 agent/rally-mcp-tools.json，也可输入完整工具名；settings.json 的 mcpTiers 每次调用重新读取，项目设置不能降低全局风险档。external 照常执行并留右栏提示和 audit.jsonl，irreversible 进入内门，不再统一暂拒绝。
- 新增 GateService、gate_decide 与 escalate(kind=gate)：校验原话引用，挂起并冻结原参数，主 agent 未处理则自动上升；主对话逐字确认卡、允许/拒绝、倒计时和结果。120 秒／上升后 10 分钟超时拒绝；取消、退出、重启使未决门失效。独立审计必须成功才能放行。范围是否覆盖由主模型判断，系统不伪称语义核验。
- MCP 模型参数统一为 {arguments: 原服务器参数, approval?: {action,scope,alternative}}，原 schema 嵌在 arguments 中，避免与任意服务器字段冲突；approval 不发给服务器。direct/codemode 的实际本地调用均验证批准后参数原样转发。只给 worker，主会话仍无 MCP。
- 生产集成 49/49、内门专项 6/6、无浏览器静态渲染 3/3，运行中改风险档与项目降档边界补测 3/3；应用双端检查、完整构建通过，根 typecheck 仍两个已知模型测试文件错误。视觉/真实供应商由用户验收，无提交。
- 下一步：问题上升及选项回答（escalate 目前只实现 gate）、完整审计字段/动作覆盖、连接状态、HTTP/OAuth、任意项目扩展。file_delete/git 受控工具尚未实现；本轮实现内门服务和 MCP 强制点，不代表这些工具或整个 TODO 已完成。

## 最新增量（2026-11-09 MCP 取消与退出清理）

- Supervisor/主会话/worker 的 dispose 改为可等待且幂等；Electron before-quit 阻止首次退出，等清理完成后再退出。正在加载资源的会话被纳入等待，晚创建的会话会自行关闭，不再复活。
- closeRoleSession 同时触发 abort 和 session_shutdown，避免单等 abort 卡在 MCP 初始化；关闭后才 dispose。worker 跟踪已从活动表移除但尚未关闭的会话，同任务续接先等待旧连接；取消/退出时未结束工具落盘为 interrupted。
- 生产离线集成 44/44（新增 6 项），本地 stdio 假服务故意挂起初始化/工具调用，取消及 Supervisor 退出均验证关闭返回时 PID 已消失；另覆盖 worker/主会话加载期间退出。应用双端检查、完整构建通过，根检查仍两个已知模型测试文件报错。
- 未运行 Electron 原生退出流程或视觉验收，真实供应商/外部 MCP 仍由用户验证。一般 shell/作业/服务的 5 秒升级强杀及崩溃孤儿清理未实现，不与 MCP transport 清理混同；HTTP/OAuth、风险档 UI/审计/内门、连接状态和任意项目扩展仍在 TODO。无提交。

## 最新增量（2026-11-09 worker MCP 基础执行）

- worker 已接 Pi MCP，默认 direct，显式 exposure 保留；只启用内置 MCP/codemode/tool_search 支持扩展。session.ts 增加动态工具允许列表、bindExtensions 启动和 closeRoleSession 幂等关闭；主会话仍无 MCP。
- mcp.ts 全工具终态 hook 防晚调用，风险来自全局 mcpTiers，非 reversible 暂拒绝，不能视为 external 审计/irreversible 门控已完成。正常收尾会发 session_shutdown 关闭 MCP，再 dispose。
- 集成 38/38，真实本地 stdio 假服务覆盖调用/终态限制/风险拒绝/正常退出 PID；双端检查和完整构建通过，根检查仍两个既有错误。真实供应商、外部 MCP、视觉由用户验收，无提交。
- 下一步补风险档设置/审计/内门、连接状态、取消/退出/HTTP/OAuth 边界以及任意扩展的信任接入；当前不可勾完资源总项。测试夹具 packages/coding-agent/test/fixtures/rally-mcp.cjs 不联网。

## 最新增量（2026-11-09 MCP 配置）

- MCP 设置已替换模拟状态，连接 main/mcp-store.ts 与 agent/mcp.json；JSON 编辑、校验、启停、删除均持久化，不再显示随机工具数或假连接。Pi SDK 导出 loadMcpConfig/validateMcpServerConfig。项目配置合并遵守信任决定。
- 目前只配置，不启动 MCP 连接；worker 工具注入、连接释放、逐工具风险档/内门以及扩展执行仍待推进。UI 已明示边界。
- 集成 37/37、应用双端类型检查、完整构建通过；根检查仍两个已知模型测试错误。未启动视觉验收或真实供应商，无提交。

## 最新增量（2026-11-09 项目信任）

- 设置页新增项目信任，使用 Pi trust.json，支持目录继承、信任及撤销；已保存路径完整列出。worker loader/SDK 与 skills 发现使用同一显式信任决定，未知/拒绝项目不加载项目 settings/skills，但 AGENTS 仍加载。显式导入 skill 是全局资源；当前会话不热更新。
- 新增 main/project-trust.ts、shared/trust.ts、ProjectTrustSection.tsx 与 IPC；Pi ProjectTrustStore 增加 list()。生产回归 36/36、trust-manager 单文件 4/4；完整构建、应用双端检查通过，根检查仍两个已知模型数据测试错误。未提交、无真实供应商或视觉验收。
- 下一步仍是 MCP/扩展执行接入及风险档/门控。信任设置已完成基础接线，但扩展仍禁用、MCP 设置仍模拟；不可勾选资源总项。

## 最新增量（2026-11-09 Skills 设置接线）

- Skills 设置页已替换模拟列表/假导入，显示实际发现资源及诊断，支持目录导入、刷新、持久化启停。配置保存于 agent/rally-skills.json；导入引用原目录，worker 新建/续接读取偏好，现有会话不热切换。
- 入口 src/main/skill-store.ts、supervisor/session.ts、shared/skills.ts、shared/ipc.ts、renderer/components/SkillsSection.tsx。通过定向集成 35/35、应用双端检查、完整构建；根类型检查仍两个已知错误。视觉及真实供应商由用户验收，无提交。
- 下一批继续 MCP/扩展及项目信任设置。MCP 设置仍是原型，扩展仍禁用；不要宣称整个资源配置项已完成。

## 最新增量（2026-11-09 worker skills）

- worker 已启用 skills 发现：提示只列名称、描述、路径，正文按需 read；主会话不自动加载 skills/项目 AGENTS。入口 `supervisor/session.ts` 的 loadProjectSkills 与 worker 调用处。
- 已补 grep 文件搜索、find 默认 cwd 的真实二进制访问记录/分页/恢复回归；离线集成设置 PI_OFFLINE=1 禁止缺工具时下载。集成 34/34、应用双端类型检查、完整构建通过；根 typecheck 仍两个既有模型数据测试文件报错。
- 下一批接真实 skills/MCP/项目信任配置与设置页。目前扩展仍禁用，MCP 未接线，原型 skills 开关尚不控制后端；不能把资源加载总项勾完。无真实供应商调用或视觉验收，无提交，沿用原工作区修改。

## 新会话从这里继续（2026-11-09 工具证据增量）

- 已继续 TODO 的工具字段收口：文件工具成功访问（含 created）、shell cwd/命令、files.accesses 分页、card/board 累计耗时、缓存 token/工具次数/已知费用持久化及推送。修复汇报后最后一条回复用量重启丢失；访问证据先于快照落盘时可恢复 changedFiles。未知费用用 costIncomplete，不把零价格配置当免费。
- 已补 dispatch/reuse.queuedReason、approve.status、steer/answer.delivery、cancel.outcome/affected、report.recorded/notifiedMain/taskEnded；支持 question=null 及终态清除。等待名额/worker 尚未启动返回 queued_for_worker；作业未实现，cancel 不虚报 killedJobs=0。相同问题幂等、上升/兜底仍未完成。
- 验证：集成 33/33、静态渲染 2/2，双端类型检查、完整构建通过；最后恢复补丁后双端检查与应用构建复核通过。根 typecheck 仍仅两个既有模型数据测试文件报错，命令与范围见 TODO 最新记录。本轮未调用真实供应商、未启动视觉验收、未改界面布局。grep/find 访问已包裹但尚未独立二进制实测，不隐式下载工具；UI 用量展示及完整投影仍是后续项。
- 下一批：补 grep/find 定向访问回归，再推进 worker skills（项目 AGENTS 已实现，不重做）、MCP/扩展信任配置与真实设置接线；门控/网络/作业/服务等独立子系统仍不填假数据。cwd #42–43 真实模型验收仍待用户确认。
- 当前仍沿用全部未提交修改，未获新提交指令。入口：`src/shared/task.ts`、`src/main/supervisor/{worker,task-store,task-read,tools,index}.ts`；回归：`packages/coding-agent/test/suite/rally-supervisor.test.ts`。

## 上一批交接（2026-11-09 连续内容修复，已验收）

- **用户最新确认**：“没问题了”，本轮 assistant loop 中间消息与 thinking 展示修复已验收，允许新会话继续后续开发。不要重新调整间距或重做这项修复。cwd 提示已更新，但用户未单独确认测试清单 #42–43，不推定为新的双协议完整验收。
- **第一步**：阅读根 `AGENTS.md`、[实施 TODO](docs/开发实施TODO.md) 与[问答记录](docs/superagent/00-问答记录.md)，核对当前 `git status`，沿用工作区现有修改。最近提交仍为 `74f7dee`，之后的工作区/工具/连续内容增量均未提交；本次只更新交接，未获新提交指令。
- **下一批建议**：先收口 TODO“工具规格逐字段”中不依赖新子系统的返回字段/用量与访问记录，核对 [02-工具规格](docs/superagent/02-工具规格.md) 和当前 `tools.ts`、`task-read.ts`、`task-store.ts`。门控/作业/服务等尚未实现的字段继续明示 coverage、留在各自 TODO，不填假数据。之后推进 worker skills、MCP/扩展与真实设置接线；worker 项目 AGENTS 已有加载与回归，不能把整个资源加载条目当作全未实现。
- **验收证据**：本轮集成 28/28、静态渲染 2/2，应用 main/preload、renderer 独立类型检查和应用构建通过。命令、覆盖范围与限制见 TODO 最后两节和[测试清单 §11](docs/测试清单-提供商与模型.md)。根 typecheck 仅两个既有模型测试文件报错；不要跑全量 vitest 或调用用户真实密钥。
- **约定**：视觉默认由用户验证，除非明确要求，不启动截图/浏览器/Electron 视觉验收。顶部不加入口；设置仅主对话默认工作区、最近项目只读，worker cwd 由 router 显式指定。根 `icon.png` 是用户资产，接入快捷方式/任务栏/托盘/安装包仍在 TODO，不删除。
- **入口文件**：连续内容投影在 `src/shared/conversation.ts`、`src/renderer/src/components/AssistantContent.tsx`；主/worker 接收和恢复在 `src/main/supervisor/main-agent.ts`、`worker.ts`、`task-store.ts`。测试在 `packages/coding-agent/test/suite/rally-supervisor.test.ts`、`src/renderer/src/components/AssistantContent.test.ts`。旧 Pi JSONL 未补录，完整运行分段/事件时间线仍未完成。

## 0. 现状一句话

主会话、供应商配置和基本任务链路已修复并通过现有能力验收。2026-11-09 用户确认真实供应商 Messages/Responses 双协议及现有能力完整测试均通过，授权继续后续 TODO。后续协议、作业/服务等仍未实现，不能据此称整个编排完成。

### 0.0 本轮收口（2026-11-09，优先于后面的历史记录）

最新修正：用户指出断续来自 loop 内内容缺失，已恢复主对话原间距。主会话保留有序 text/thinking/tool 块，worker 中间 assistant 消息接入流式、持久化及工具关联；主/任务页的思考与工具同级、默认收起。仅展示供应商返回的可读 thinking；task_read 不返回 worker 完整对话；不补录旧 Pi JSONL。集成 28/28、无浏览器静态渲染 2/2、应用双端类型检查和应用构建通过；根 typecheck 仍两个已知模型测试文件报错。用户已确认本轮连续内容修复“没问题了”。主提示词已补充 cwd 选择纪律，专项模型行为未单独确认；根 AGENTS.md 约定视觉由用户负责。

后续增量（基线提交 `74f7dee` 之后，尚未提交）：按用户最新修订，设置 → 项目与工作区只配置主对话默认工作区，最近任务项目只读展示；顶部不增加入口并保留拖拽区。`WorkspaceStore` 保存 `~/.rally/workspace.json`，忽略旧 currentProject；4 个主只读工具按默认工作区解析相对路径，主 session cwd 固定。worker cwd 必须由 router 显式指定绝对路径，实际启动后记录最近项目；已有任务目录不迁移。

工具增量：task_read 六种 view 与分页、20 条结束任务历史、跨重启 60 秒派发幂等、更新/续接/启动 scope 警告；主/worker 工具活动接入原型折叠列表并持久化。当前只展示有界参数、输出、状态和耗时；完整访问痕迹、费用/退出码/diff、内门仍未齐全，见 TODO。定向回归 25/25、应用双端类型检查和应用构建通过；两个隔离 Electron 验证覆盖工作区修订与工具链路/重启。根 typecheck 仍为已知两个模型数据测试报错。目录选择器用了自动化替身；拖拽仅验证命中区域属性，未做原生鼠标拖动实测。最新增量未重跑真实供应商。

- `supervisor/session.ts` 统一角色会话创建：resource loader 显式 reload，白名单包含 custom tools，创建后校验角色与实际 active tools。主会话只读 + 8 个任务工具，worker 无派发/子 agent；禁用 Pi 默认身份和不存在的 docs 注入。
- `ModelStore` 保存独立 `active`/`worker`（模型及思考档位），共用 Rally 供应商运行时。设置页两套选择器，主对话仍可切主模型。worker 启动/续接读当前设置，不回退 Pi 默认；缺模型明确失败。
- 用户消息附宿主 `#N`，任务工具引用逐字原话。note 只作路由背景/明确约束，统一长度与描述；代答要求当前 questionId，不再允许主模型自编 answer 替代原话。
- 审批开关持久化，旧 pending 不追溯批准。主对话卡片展示原话/cwd/mode 后批准，右栏只读。无模拟百分比，工位名片展示实际双模型。
- 补启动取消/终态晚报保护、按 taskId 去重名额、空闲 worker 唤醒排队、同 JSONL 续接重新审批/换模型、重启 interrupted 待决；readonly write/edit 检查产出目录及 junction，成功写入及时记录 changedFiles。
- “整理上下文”真实调用 compact，保留 UI 历史和原话 ID；压缩后的任务状态重注入、chat_search 和物理分段仍未做。
- 定向自动测试在 `packages/coding-agent/test/suite/rally-supervisor.test.ts`，使用 harness/faux provider，不调真实 API。Electron 以隔离 HOME/AppData 和本地假 Messages 服务验证模型选择、高档位实际参数、主对话审批、读文件/汇报/唤醒、开关及模型/任务重启恢复，renderer 异常 0。
- 双端类型检查、完整构建通过；根 typecheck 仍被两个既有模型数据测试阻塞。最终测试数量与复核结果见 TODO。
- 真供应商 Messages/Responses 和现有能力完整清单已由用户实测通过；当前收口已验收。后续缺口仍未勾选，按 TODO 顺序推进，不宣称整个编排完成。

### 0.1 D: 会话进展

已完成：

- §3.1–3.4 第 5 步：根 `package.json`、三个 tsconfig、`electron.vite.config.ts`、`electron-builder.yml`、`src/` 骨架、安装、模型数据、构建、冒烟（`RALLY_SMOKE=1`）。
- §4：bin/exports 已改；`.pi` 文案已改；`AGENTS.md` 已建；README 已重写。
- 原型搬入 `src/renderer/src`：去掉了模拟桌面和窗口框，换成无边框 Electron 窗口，标题栏按钮经 IPC 控制真实窗口。

和 §4 不一样的地方：`startup-ui.ts` 的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"` **不要改**，它判断“是否官方 Pi 发行版”，Rally 必须判定为否。

未完成：

- 附录 B 第 1–7 项实测，结果写到 `docs/superagent/06-M0实测.md`。第 8 项（node-pty）留到做终端时；第 9 项只作参考。
- `npm run dist` 打包未实测（workspace 链接的 `@rally/*` 能否正确进包要验证）。
- `@rally/ai` 的 `fireworks-models` 等测试类型报错：模型数据是当天拉取的，和测试写死的模型名对不上。
- 模型数据是否入库仍待定，目前已 gitignore。

M1 接后端时，原型需要按问答记录调整的点：

| 原型现状 | 按问答记录改为 | 依据 |
| --- | --- | --- |
| `data.ts`、`App.tsx` 的 `send` 是演示数据和模拟流程 | 接 IPC 与真实事件 | M1 |
| 任务卡有进度条和技能标签 | 只显示粗略状态＋时间 | Q13/Q16 |
| “新建对话”（按钮、Ctrl+N、菜单、命令面板） | “整理上下文” | Q11 |
| 浏览器标签是 iframe（CSP 暂开 `frame-src`） | `WebContentsView`，独立 partition，改完收紧 CSP | Q20 |
| 终端是模拟的 | xterm.js＋node-pty，归用户 | Q20 |
| 配置存 localStorage | 主进程持久化：供应商/模型写 `~/.rally/agent/rally-models.json`；主会话模型在对话框底部选择 | Q22 / M1-C |

### 0.2 M1-A 进展（2026-11-08 第二段会话）

已完成「主会话接后端」：

- 新增 `src/main/supervisor/event-log.ts`（单写者、单调整数 seq、`state/events-0001.jsonl` 追加日志，重启回放）。
- 新增 `src/main/supervisor/main-agent.ts`：用 Pi `createAgentSession` 建主会话（`cwd=~/.rally/agent/main`，`SessionManager.continueRecent(mainCwd, sessionsMainDir)`），只启用 `read/grep/find/ls`，`noContextFiles/noExtensions/noSkills/noPromptTemplates/noThemes`，系统提示来自 `src/main/prompts.ts`。
- 聊天流：监听 Pi 的 `message_start/update/end`，助手消息按 `#N` 编号落事件日志；`agent_start/agent_end` 驱动 busy；用户消息立即入列并落盘（不回显 Pi 的 user 事件）；忙时 `sendUserMessage(..., { deliverAs: "steer" })`。
- IPC：`chat:state/send/abort/reset` + `chat:event` 推送（`src/shared/ipc.ts`、`src/main/ipc.ts`、`src/preload/index.ts`）。
- 渲染层：`src/renderer/src/chat.ts` 的 `useChat` 接管消息/忙碌状态；`App.tsx` 删除模拟发送与定时器；`ChatPanel` 新增系统行渲染。
- `paths.ts` 新增 `sessionsMainDir/sessionsTasksDir/eventsFile/snapshotFile/auditFile/jobsDir` 并创建目录。

验证：`tsc -p tsconfig.node.json` 与 `-p tsconfig.web.json` 通过；`electron-vite build` 通过；`RALLY_SMOKE=1` 通过（`model` 现在是 `unknown/unknown`，`modelFallbackMessage` 提示未配置 provider）。根 `typecheck` 仍因 `packages/ai/test` 的模型数据旧断言失败（§4 已记）。

已知偏差/待办：

- 提示词暂放 `src/main/prompts.ts`（03 §6 说的“核心包 prompts/”尚不存在）。
- `chat:reset` 的旧“新开会话 + 清屏”已在本轮替换为 compact，见 §0.0。
- 未配置 provider 时，发送只得到一条系统行；M1-C 已补上真实提供商配置（见 §0.4）。
- 本沙箱里 Electron 子进程无法在 `~/.rally` 下新建目录（`EPERM`），验证前需手工建好 `sessions/main`、`sessions/tasks`、`state/jobs`；真实用户运行无此问题。
- 下一阶段 M1-B：TaskStore/调度/派发/批准/worker 汇报/唤醒闭环。

### 0.3 M1-B 进展（2026-11-08 第三段会话）

历史实现记录（曾误报闭环完成；本轮修复及验证以 §0.0/TODO 为准）：

- `src/shared/task.ts`：Task/Run/Input/Attention/Usage 与显示状态推导；`scope: string[]`、`changedFiles`；`QueueReason` 仅 `dependency_failed | dependency | capacity`（无 `write_lock`、无 lock 字段）。
- `src/main/supervisor/task-store.ts`：事件流单写者落任务快照；创建时 scope 与运行中任务交叉只产生 `warnings` 并记 `task_scope_overlap`，不阻止；批准/取消/更新/续接/steer/answer/汇报/运行开始结束/实际改动文件/用量全部落事件。
- `src/main/supervisor/tools.ts`：主 agent 的 `task_dispatch/approve/update/steer/answer/resume/cancel/read`；worker 的 `task_report/task_read`（只能看自己与上游）。
- `src/main/supervisor/worker.ts`：每任务一个 Pi 会话（`sessions/tasks/<taskId>.jsonl`），工具集 read/write/edit/grep/find/ls + bash/powershell，注入 `RALLY_TASK_ID`、`RALLY_OUTPUT_DIR`（这仅是环境提示，构建产物强制隔离尚未落实）；tool 事件收集实际改动文件与用量；轮末未汇报先 nudge、再犯记 blocked；终态释放会话。
- `src/main/supervisor/scheduler.ts`：默认名额 2、依赖阻塞（`dependency`/`dependency_failed`，后者只唤醒一次）、容量排队（`capacity`/`waiting` 事件）、启动恢复后中断的 run 等用户决定（不自动重跑）。
- `src/main/supervisor/relay.ts`：worker 汇报/提问/依赖失败/中断 → 忙时 steer、闲时 2s 合并为一个 turn；notice 不唤醒。
- `src/main/supervisor/index.ts`：总装 Supervisor；启动时把未结束 run 标 interrupted 并唤醒主 agent；`approve/cancel` 宿主接口已接线。本轮批准按钮已移到主对话，右栏只读。
- IPC：`tasks:state/approve/cancel` + `task:event`；preload 暴露 `window.rally.tasks`；renderer 用 `useTasks` 镜像真实任务，工位列表替换 mock，待批准卡片有“批准派发/取消”。
- 文档已按最终口径改完（04 §2 写范围声明＋警告、构建隔离；00 Q2/Q6/Q8/Q9/Q17；01/02/03；改造计划 C10、§5.2、M2），不再保留“git worktree 根加锁”。

验证：

- `tsc -p tsconfig.node.json`、`-p tsconfig.web.json` 通过；`electron-vite build` 通过；`RALLY_SMOKE=1` 通过。
- 真实启动 5 秒无主进程错误。
- 一次性逻辑校验（临时脚本，已删）：scope 交叉恰好 1 条 `task_scope_overlap`；limit=2 时第 3 个任务排队 `capacity` 且记 `waiting`；上游 failed 后下游 `dependency_failed` 且只唤醒一次；任务对象无 lock 字段。

当时的偏差及当前状态（不作为闭环完成证明）：

- 当时只读任务仅有提示词约束；本轮已强制拦截产出目录之外的 write/edit，包括路径穿越与 junction。shell 仍不是文件沙箱，完整访问痕迹待实现。
- `bash/powershell` 的重定向目标未进 `changedFiles`（只收集 write/edit 的 path）；间接改动仍是已知局限。
- 作业（jobs）与服务（services）未实现；`stop{target:"service",source:"user"}` 事件类型已定义，右栏“停止服务”直连尚无服务可停。
- 当时 `autoApprove` 硬编码为 false、worker 沿用默认模型；本轮已接持久审批开关与独立任务模型/思考档位，见 §0.0。
- 无 provider 时主会话与 worker 都只得到未配置提示；M1-B 的真实模型端到端仍未实测。
- 主 agent 系统提示与 worker 提示在 `src/main/prompts.ts`，尚未迁到 03 §6 的核心包 `prompts/`。

### 0.4 M1-C 进展（2026-11-08 第四段会话）

以下是 11-08 的历史范围；本轮已按 Q22 接入任务模型并修复调度，见 §0.0。

已完成：

- `src/shared/models.ts`：Provider/Model/Active/ModelsState/FetchModelsResult 等契约；`THINKING_LEVELS` 与 `defaultModel`。
- `src/main/model-store.ts`：`ModelStore` 读写 `~/.rally/agent/rally-models.json`（明文、`version/active/providers`），把每个供应商用 `ModelRuntime.registerProvider` 注册进 Pi；`api` 映射为 `messages → anthropic-messages`、`responses → openai-responses`，**不自写 HTTP 适配**。
- 模型列表拉取：主进程请求 `<baseUrl>/models`（messages 带 `x-api-key` + `anthropic-version`，responses 带 Bearer），失败/超时/非 2xx 都返回可读文案，不抛异常。
- 模型元数据：上下文长度、压缩阈值、最大输出、视觉、思考、可选思考档位（`thinkingLevelMap`，`off` 始终可用）。压缩阈值目前仅保存与展示，不驱动 Pi 自动压缩（Pi 只有 `contextWindow` 触发压缩）。
- 主会话接入：`MainAgent` 启动时用同一 `ModelRuntime`，按文件里的 `active` 恢复模型与思考档位；新增 `selectModel()`（`session.setModel` + `setThinkingLevel`，持久化），以及保存供应商后的 `reapplyActiveModel()`（改 URL/Key 后无需重新选择即可生效）。
- IPC：`models:state/save/fetch/select`；preload 暴露 `window.rally.models`；`ChatState` 增加 `thinkingLevel/thinkingLevels`。
- 渲染层：`src/renderer/src/models.ts`（模块级共享缓存 + `useModels`）；`forms.tsx` 的 `ProvidersForm` 重写为多供应商卡片（无任何预设模板、拉取/手填、逐模型元数据、显式「保存配置」）；`ModelPicker.tsx` 为分组选择器（浅色供应商名 + 模型，思考模型向右展开强度面板）；设置页删除了旧的「模型」小节，引导页删除了「模型用途」步骤。
- 测试清单：`docs/测试清单-提供商与模型.md`（23 条，★ 为必过项）。

验证：

- `npx tsc --noEmit -p tsconfig.node.json`、`-p tsconfig.web.json` 通过；`npx electron-vite build` 通过。
- 一次性脚本（Temp，已删）在 Pi 层验证通过：供应商注册、模型解析、`session.setModel` 跨供应商切换、`setThinkingLevel`、默认/声明档位（`off,minimal,low,medium,high` / `off,low,high`）、非法 Base URL 报错、拉取失败返回可读文案、active 在模型删除后被清理、配置文件为明文 JSON。
- **未自测**：`RALLY_SMOKE=1`、`npm run dev` 与所有需要点界面的条目——本会话工具环境审批拒绝启动完整 Electron（详见清单 §8）。真实模型回复、错误凭据、真实任务端到端同样需要用户实测。

已知边界（M1-C 范围内）：

- 「压缩阈值」是 Rally 元数据，未接入 Pi 的自动压缩参数。
- 模型列表拉取只覆盖 `/models` 这一常见形态；供应商没有该接口时走手填。
- 供应商配置是显式保存（不是逐字段自动保存）；未保存时页面显示「未保存」。
- 主/任务模型已分别接 Rally 供应商配置。旧“双模型 v1 不做／接线待批准”与 Q22 冲突，已撤回，无此额外批准要求。
- `chat:reset` 已改为上下文压缩，保留 UI 历史与原话引用；更多压缩协议仍待补齐。

### 0.5 交接速查（新会话先看这段）

**已有基础实现（不等于阶段验收）**

| 里程碑 | 实际做了什么 |
| --- | --- |
| M1-A | Rally 角色会话、事件日志、聊天 IPC、真实流式对话、中止/压缩；状态重注入/检索仍未完成 |
| M1-B | 无锁 TaskStore、基本依赖/名额/取消/续接、worker 汇报与 relay、主对话审批；持久中继/幂等/完整轨迹等仍未完成 |
| M1-C | Rally 供应商配置 + Pi 运行时 + 模型列表/手填 + 主/任务模型与思考选择器 + 持久化；真实服务清单未验收 |

**配置文件**

- 路径：`C:\Users\<用户名>\.rally\agent\rally-models.json`（与 Pi 的 `models.json`、`auth.json` 不冲突）。
- 结构：`{ version: 1, active: Selection | null, worker: Selection | null, providers: ProviderEntry[] }`；Selection 含 provider/model/thinkingLevel。旧文件无 worker 时保持未配置，不自动回退。
- 协议值：`messages` / `responses`；写入 Pi 时映射为 `anthropic-messages` / `openai-responses`。

**测试清单**：`docs/测试清单-提供商与模型.md`（★ 为必过项；§8 列出无法自测项）。

**当前必须靠真模型验证的**

- 聊天能真的流式回复、切换模型后下一条消息用新模型、重启后选择保留。
- 错误 Key / 断网时的界面错误提示。
- 真实任务端到端：派发 → 主对话批准 → worker 使用任务模型运行 → 汇报回主对话。本地假 HTTP/UI 已跑通，用户已确认真实供应商双协议及当时现有能力完整测试通过。

**无需再询问的已定项**

- 主/任务两个全局模型是 Q22 已定，worker 同一供应商配置接线已实施。

**下一步建议顺序（理由）**

1. **先按清单做真模型实测**：M1-C 的价值全在“能配、能选、能跑”，未实测前不要叠加新功能。
2. 实测暴露问题就地修（供应商/选择器/主会话切换相关问题优先）。
3. 按实施 TODO 补 M1 剩余协议，不把压缩按钮已接线等同于整个压缩/恢复完成。
4. 当前收口验收后，再考虑作业/服务及其他未实现能力；任务模型已在本轮接通。

### 0.6 已否决 / 已定不做（不要再提、不要重试）

- **写锁/租约/目录归属/阻塞 `acquire`**：已定不做。并发靠 `scope` 声明 + 交叉警告 + `changedFiles` 事后追踪 + 构建产物独立后缀。
- **按任务临时指定模型**：不做。Q22 采用两个全局设置；派发/续接工具没有 model 参数。
- **任务卡百分比进度**：不做，只显示粗略状态与时间。
- **“汇报必须带原话引用”**：不成立；`task_report` 没有 quotes 参数，宿主也不校验。
- **停止服务经 worker**：已定改为右侧按钮直连，事件写 `stop(source=user)`；改任务内容仍必须走 `task_steer`。
- **内置 OpenAI/Anthropic 等供应商预设模板**：M1-C 明确不做，供应商一律由用户自填。

## 1. 为什么在 D 盘

- `E:` 是 **exFAT**（簇大小 256KB），**不支持 junction 和符号链接**（实测 `EISDIR`）。npm workspaces 在 Windows 上靠 junction 链接 `node_modules/@rally/*` → `packages/*`，在 E: 上装不起来。
- `D:` 是 NTFS（4KB 簇，junction 实测可用），剩余约 76G。
- **`D:\Rally-agent` 是唯一的正本**。`E:\Rally-agent` 是迁移前的副本（其中 `packages/` 是**改名前**的状态），确认 D 盘无误后由用户自行删除；不要再在 E: 上工作或安装依赖。
- 选定方案：**标准 npm workspaces**，Electron 应用就在仓库根目录（不再嵌套一层目录），Pi 源码在 `packages/*`。

## 2. 已完成

### 2.1 文档

| 文件 | 内容 |
| --- | --- |
| `docs/superagent/00-问答记录.md` | 24 题问答原文、派生默认值、未提问默认值 A1–A10；**决策唯一依据** |
| `docs/superagent/01-角色与协议.md` | 角色、领域对象（Task/Run/Input/Attention/Gate）、显示状态推导表、主流程、中继格式、主 agent 上下文、事件清单 |
| `docs/superagent/02-工具规格.md` | 主 agent 22 个工具、任务 agent 22 个工具＋MCP 的参数与返回、门控分档、投影信封、访问痕迹 |
| `docs/superagent/03-提示词.md` | 组装顺序、优先级、英文提示词初稿、消息模板 |
| `docs/superagent/04-工作区与并发.md` | 目录模型、写锁、调度与名额、worker 生命周期、作业/服务、持久化、启动恢复 |
| `docs/superagent/05-界面与交互.md` | 主对话卡片、右栏只读、浏览器/终端、设置页、开源复用选型（许可证已核实） |
| `docs/改造计划.md` | v3 总纲与决策表（C1–C10、D1–D15、里程碑 M0–M5、附录 B 实测清单） |

### 2.2 Pi 源码搬迁（"搬源码改"）

来源：`example/pi`（上游 `earendil-works/pi`，基准 `085c84e`，v1.5.0，MIT）。

| 目录 | 包名（改后） | 上游包名 |
| --- | --- | --- |
| `packages/telemetry` | `@rally/telemetry` | `@earendil-works/pi-telemetry` |
| `packages/schema` | `@rally/schema` | `@earendil-works/pi-schema` |
| `packages/tui` | `@rally/tui` | `@earendil-works/pi-tui` |
| `packages/codemode` | `@rally/codemode` | `@earendil-works/pi-codemode` |
| `packages/mcp` | `@rally/mcp` | `@earendil-works/pi-mcp` |
| `packages/ai` | `@rally/ai` | `@earendil-works/pi-ai` |
| `packages/agent` | `@rally/agent-core` | `@earendil-works/pi-agent-core` |
| `packages/coding-agent` | `@rally/coding-agent` | `@earendil-works/pi-coding-agent` |

- 依赖关系：coding-agent → agent-core、ai、codemode、mcp、tui；agent-core → ai、schema；ai → schema、telemetry。这 8 个包自成闭包；没搬 env/chord/durable/evals/apps。
- 没搬：各包的 `node_modules`、`dist`；coding-agent 的 `docs/`（14M）、`examples/`（34M）、`install-lock/`、`tsconfig.examples.json`（需要参考时看 `example/pi`）。
- 每个包放了一份 Pi 的 `LICENSE`（MIT，Copyright (c) 2025 Mario Zechner）；mcp、schema 自带的 `THIRD_PARTY_NOTICES` 保留。**分发时必须保留这些声明。**
- 根目录带过来的构建支持文件：`tsconfig.base.json`（原样）、`vitest.base.ts`（已精简为这 8 个包、`@rally/*` 别名）、`biome.json`（includes 已改为 Rally 布局）、`scripts/package-files.mjs`、`scripts/biome/model-type-comparison.grit`。
- 这 8 个包都**没有原生 node 插件**依赖（photon、quickjs 是 WASM）；唯一的 `.node` 是 tui 的 Windows 剪贴板预编译件（N-API），只在 TUI 里用。

### 2.3 改名（C4）

- `@earendil-works/pi-*` → `@rally/*`：431 个文件 983 处，外加 3 个 vitest 配置里的正则写法。`CHANGELOG.md` 与 `.jsonl` 测试夹具**未改**（历史记录／会话数据）。
- `packages/coding-agent/package.json` 的 `piConfig` 改为 `{ "name": "rally", "configDir": ".rally" }`。由此 `APP_NAME=rally`、全局目录 `~/.rally/agent`、环境变量 `RALLY_CODING_AGENT_DIR` / `RALLY_CODING_AGENT_SESSION_DIR`、调试日志 `rally-debug.log`（机制见 `src/config.ts:602-611`）。
- **扩展兼容**：`src/core/extensions/virtual-modules.ts` 与 `loader.ts` 的别名表里，除 `@rally/*` 外保留了 `@earendil-works/pi-*` 和 `@mariozechner/*`，Pi 生态的现成扩展仍能加载。

## 3. 下一步（按顺序）

### 3.1 根 `package.json`（草案，版本已于 2026-11-08 核实）

```json
{
	"name": "rally",
	"productName": "Rally",
	"version": "0.1.0",
	"private": true,
	"type": "module",
	"main": "./out/main/index.js",
	"workspaces": ["packages/*"],
	"engines": { "node": ">=22.19.0" },
	"scripts": {
		"dev": "electron-vite dev",
		"build:packages": "npm run build -w @rally/telemetry && npm run build -w @rally/schema && npm run build -w @rally/tui && npm run build -w @rally/codemode && npm run build -w @rally/mcp && npm run build:offline -w @rally/ai && npm run build -w @rally/agent-core && npm run build:unbundled -w @rally/coding-agent",
		"build": "npm run build:packages && electron-vite build",
		"preview": "electron-vite preview",
		"typecheck": "tsc --noEmit -p tsconfig.json",
		"dist": "npm run build && electron-builder --win"
	},
	"dependencies": {
		"@rally/agent-core": "1.5.0",
		"@rally/ai": "1.5.0",
		"@rally/coding-agent": "1.5.0"
	},
	"devDependencies": {
		"@biomejs/biome": "2.3.5",
		"@tailwindcss/vite": "4.3.5",
		"@types/node": "22.19.19",
		"@types/react": "19.3.0",
		"@types/react-dom": "19.3.0",
		"@vitejs/plugin-react": "6.2.1",
		"clsx": "2.1.1",
		"electron": "45.2.3",
		"electron-builder": "26.18.0",
		"electron-vite": "6.0.0",
		"lucide-react": "1.70.0",
		"react": "19.3.1",
		"react-dom": "19.3.1",
		"tailwind-merge": "3.7.0",
		"tailwindcss": "4.3.5",
		"typescript": "7.0.2",
		"vite": "8.3.6",
		"vitest": "4.1.12"
	},
	"overrides": { "protobufjs": "7.6.6" }
}
```

| 版本要点 | 说明 |
| --- | --- |
| electron 45.2.3 | 自带 Node 24.22.2、Chrome 156；满足 Pi 的 `node >=22.19` |
| electron-vite 6.0.0 | 支持 vite `^6 \|\| ^7 \|\| ^8` |
| @vitejs/plugin-react 6.2.1 | 要求 vite `^8` |
| typescript 7.0.2、vitest 4.1.12、@types/node 22.19.19、biome 2.3.5 | 与 Pi 保持一致，避免装两套 |
| 本机 | Node v24.11.1、npm 11.6.2、registry `registry.npmjs.org` |

- coding-agent 用 `build:unbundled`（Pi 的 `build` 还会跑单文件 bundle 脚本，Rally 不需要，那个脚本也没搬）。
- ai 用 `build:offline`，前提是先生成模型数据（3.4）。

### 3.2 其余配置

1. `tsconfig.json`（根，`noEmit`）：参照 `example/pi/tsconfig.json`，`paths` 把 `@rally/*` 指向 `packages/*/src`，删掉 chord/durable/env/agent-old 的条目；`exclude` 加上引用未搬 examples/docs 的 14 个测试文件（§4）。
2. `tsconfig.node.json`（main/preload）、`tsconfig.web.json`（renderer）。
3. `electron.vite.config.ts`：main 输出 ESM 并外部化依赖（`@rally/*` 运行时经 workspace 链接加载各包 `dist`）；preload 输出 CJS（配合 `sandbox: true`）；renderer 用 React＋`@tailwindcss/vite`。**先读 `node_modules/electron-vite` 的类型定义再写配置**（vite 8 改用 rolldown，选项名可能有变化）。
4. `electron-builder.yml`：NSIS、按用户安装、appId（附 A1）。
5. `.gitignore` 补 `out/`、`packages/*/dist`、`packages/ai/src/providers/data/`（若决定不提交模型数据）。

### 3.3 `src/` 骨架

```text
src/
├─ main/        index.ts（单实例锁、窗口 titleBarOverlay）、paths.ts（~/.rally 布局，见 04 §1）、ipc.ts
├─ preload/     index.ts（contextBridge 暴露类型化 API）
├─ shared/      IPC 契约与事件类型
└─ renderer/    index.html、src/main.tsx、App.tsx（双栏壳；视觉 token 取自 example/rally-ai-agent-ui-design/src/index.css）
```

### 3.4 安装、生成、构建、冒烟

1. `npm install --ignore-scripts`（遵循 Pi 的安全约定：不跑依赖的生命周期脚本）。
2. `node node_modules/electron/install.js` 单独下载 Electron 二进制；慢就设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
3. `npm --prefix packages/ai run hydrate-model-data`：**需联网**（models.dev、OpenRouter、Vercel AI Gateway、NVIDIA NIM 等）。Pi 把生成结果 `packages/ai/src/providers/data/` 放进了 gitignore；Rally 要不要提交它以便离线构建，待定。
4. `npm run build:packages`。
5. 冒烟（M0 判据）：主进程里 `createAgentSession({ cwd, agentDir: <~/.rally/agent>, sessionManager: SessionManager.inMemory(), tools: [...] })` 能创建会话、列出工具；确认没有写入 `~/.pi`。建议做成 `RALLY_SMOKE=1` 启动时打印结果后退出，不弹窗。
6. 然后做改造计划附录 B 的实测项（多会话同进程、steer/唤醒 API、`tool_call` 钩子能否异步挂起等）。

## 4. 历史问题与待清理（当前状态以 §0.0 和 TODO 为准）

- **历史 `.pi` 清理记录**：资源与配置路径使用辅助函数和 `CONFIG_DIR_NAME`。`packages/coding-agent/src/cli/startup-ui.ts` 的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"` 是官方发行版判断，故意保留，不能替换。
- **coding-agent 的 package.json**：`bin` 仍是 `"pi": "dist/bundle/cli.js"`，`exports["./rpc-entry"]` 指向未构建的 `dist/bundle/`，`files` 里还有 `docs`/`examples`。workspaces 会给 `pi` 建一个指向不存在文件的 bin 垫片，且与 C4 冲突 → 改成 `rally` 或删除。ai 的 `bin` `pi-ai` 同理。
- **测试**：`packages/coding-agent/test/config.test.ts` 用 `@earendil-works` 模拟 CLI 安装路径（夹具，未改）。14 个测试文件引用了未搬的 `examples/` 或 `docs/`：`changelog`、`compaction-extensions-example`、`extensions-discovery`、`git-merge-and-resolve-extension`、`input-transform-streaming-example`、`jev-router-example`、`plan-mode-extension`、`plan-mode-utils`、`subagent-extension`、`suite/agent-session-mcp`、`suite/regressions/8261-subagent-project-trust`、`system-prompt`、`tool-renderer-examples`、`trigger-compact-extension`（另有 fixtures 里的 jsonl 提到 examples 路径，属数据）。
- **ai 的 devDependency `canvas`** 是原生模块，`--ignore-scripts` 下不会装预编译件，只影响用到它的测试。
- **Pi 的 AGENTS.md 规则对 `packages/` 继续适用**：只用可擦除的 TS 语法；coding-agent 的资源路径一律经 `src/config.ts` 的辅助函数；不要直接跑全量 vitest（e2e 测试检测到密钥环境变量会真调 API），按单个测试文件跑；新依赖保持精确版本。建议在 Rally 根目录建 `AGENTS.md`（或 `CLAUDE.md`）收录这些规则。
- **根 `README.md`**：已按本轮真实现状更新，实施与验收状态链接至 TODO。
- **工具环境的坑**：本会话的 Bash 工具会把命令里的 `\\` 吞成 `\`。写涉及反斜杠的脚本时用 `String.fromCharCode(92)`，或把脚本写进文件再执行。

## 5. 协作偏好（给下一个会话）

- 中文交流。设计决策用问答形式（AskUserQuestion，带推荐项）；用户倾向最小范围、信任 agent（如不设预算上限、worker 说完成就完成、不做回滚）。
- 原型 `example/rally-ai-agent-ui-design` **只作风格参考**，不从原型推导功能。
- 用户希望直接推进、少做确认。已明确："搬源码改"；工程放在仓库根目录，不再嵌套目录。
- 本会话的 Claude Code 记忆目录按路径区分（E: 与 D: 不同），所以交接信息都写在本文里。

## 6. 文件索引

| 路径 | 用途 |
| --- | --- |
| `HANDOFF.md` | 本文 |
| `docs/superagent/00–05` | 设计分册（以 00 为准） |
| `docs/改造计划.md` | 总纲与决策表 |
| `docs/prototype-inventory.md` | 原型盘点（2026-11-07 快照，部分结论已被 v3 取代） |
| `packages/*` | 改名后的 Pi 源码 |
| `example/`（gitignore） | 上游参考：`pi`、`dsh-superagent`、`rally-ai-agent-ui-design` |
