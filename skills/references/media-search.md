
# Rally 生图与网络搜索供应商

先区分用户要配置图像生成、`web_search`，还是两者；每种能力分别维护 provider 与首选项。Worker 看不到未引用的主 Agent 对话，不从“换成上次那个”猜服务、Key 或模型。

## 配置位置与字段

- 文件：`$RALLY_CODING_AGENT_DIR/rally-tool-providers.json`；实际保存应优先经过 Rally 设置接口/UI，文件供核对，不建议绕过校验手改。
- 根字段：`version: 1`、`images`、`search`、`preferredImage`、`preferredSearch`。保存时有并发保护 `revision`，旧 revision 会被拒绝，需刷新后重做。
- `images` 最多 16 项：每项有唯一 `id`、`name`、`baseUrl`、`models`（最多 32 个、必填且不能重复），可选 `responseFormat`=`b64_json` 或 `url`。Base URL 必须是 HTTP(S)，不能含用户名/密码、query、fragment 或 `/images/generations` 后缀。供应商与模型 ID 有长度限制（分别最多 100/200 字符）。
- `preferredImage`：`null` 或 `{ providerId, model }`，必须指向已配置图像 provider 的真实模型；存在图像配置时必须选择首选模型。
- `search`：仅支持 `tavily`、`exa`、`brave` 三种 ID；每家最多配置一次。`preferredSearch` 必须指向已配置的 provider；搜索列表非空时必须选首选项，列表为空时必须为 `null`。
- API Key 不会从状态读取出来：未提供新 Key 表示沿用原凭据。服务端经 Rally CredentialVault 加密保存；不得从普通配置、错误文本或脱敏状态尝试还原。

## 设置步骤与验证

只展示与用户所选能力相关的字段。图像模型目录并不由此配置自动从通用 `/models` 获得；让用户提供准确模型 ID，或使用用户明确指定且当前集成支持的模型列表，不要编造。搜索 provider 是固定三选一。新加 provider 不得擅自替换用户当前首选项，除非用户明确要求。

真实生图/搜索可能产生费用或访问外部服务；保存配置不是测试授权。未获明确授权时只用设置状态核对 provider、模型、首选项和凭据是否已配置，不发真实生成/搜索请求。刷新后若 revision 冲突，先重新读取再合并，只保留用户本次要求。
