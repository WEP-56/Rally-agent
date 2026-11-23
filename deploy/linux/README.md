# Rally Linux 服务端

本包包含固定版本 Node、Agent 运行时、部署控制台、Chromium Headless Shell 和运行依赖。下一版 Linux 包另含 GitHub CLI（gh 2.105.0）；已发布的 v0.3.0 尚未包含。无需 Electron、源码构建或全局 npm 安装。当前已验证 Ubuntu 22.04 x64；需要 systemd、curl，以及任务实际使用的 git、Python 等外部工具。安装器会通过固定版本 Playwright 的 `install-deps chromium` 安装系统共享库和字体，因此安装时需要可用的软件源。

## 从 GitHub Release 安装

从项目 Releases 下载同版的 `rally-server-X.Y.Z-linux-x64.tar.gz` 与 `SHA256SUMS`。先检查摘要，再解包和安装：

```bash
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf rally-server-X.Y.Z-linux-x64.tar.gz
cd rally-server-X.Y.Z
sudo bash install.sh
sudo systemctl status rally-runtime rally-control
```

安装目标为 `/opt/rally/releases/X.Y.Z`，`/opt/rally/current` 指向当前版本。代码由 root 持有，服务以独立的 `rally-runtime` 与 `rally-control` 账号运行。不要将服务改为 root。

首次安装在 `/etc/rally` 生成管理密钥与连接器加密密钥。通过 SSH 在服务器本机查看管理密钥：

```bash
sudo cat /etc/rally/admin.key
```

控制台默认只监听 `127.0.0.1:4711`。正式使用时在它前面配置 HTTPS 反向代理。IP 直连测试可将 `/etc/rally/server.env` 改为：

```ini
RALLY_HOST=0.0.0.0
RALLY_PORT=4711
```

然后运行 `sudo systemctl restart rally-control`，开放对应端口。HTTP 测试连接不加密。访问 `http://服务器IP:4711`，输入管理密钥，给每台设备分别签发一次性接入密钥；客户端填写同一 URL 和该设备的接入密钥。管理密钥不能用于客户端配对。

控制台只管理实例、设备、接入密钥和新设备配对开关。模型、提供商、MCP、技能、连接器、记忆、工作区等在已连接的 Rally 客户端配置。所有路径都是 VPS 路径。示例工作区 `/var/lib/rally/rally`，Agent 数据 `/var/lib/rally/.rally`；客户端关闭不停止服务。

## 运行与维护

```bash
sudo systemctl restart rally-runtime rally-control
sudo journalctl -u rally-runtime -u rally-control -n 100 --no-pager
curl --fail http://127.0.0.1:4711/health
```

`/health` 确认接入服务响应；运行时失败时客户端会提示暂不可用。配对、设备在线状态和吊销在控制台查看。配对码仅使用一次；丢失或重装客户端时在控制台吊销原设备并生成新码。设备令牌与管理权限分离。

服务端使用系统时区，可通过 `timedatectl` 查看。定时计划记录自己的时区；客户端展示服务器执行状态。运行账号默认仅能写入 `/var/lib/rally` 和自身临时目录；外部工作目录需由管理员明确授予权限，并相应调整 systemd `ReadWritePaths`。不把私有服务端口自动暴露到公网。

## GitHub CLI 与用户工具

下一版构建时从 GitHub 官方 Release 下载固定版本 gh，校验代码中固定的 SHA256，将可执行文件及 MIT 许可证放入安装包 `bin/gh`、`bin/GH-LICENSE`。服务通过 `/opt/rally/current/bin` 调用，无需运行账号拥有 sudo 权限。

用户自行安装的工具放在 `/var/lib/rally/.rally/agent/bin`；Shell 与专用 GitHub 工具都搜索此目录。这个数据目录与版本目录分离，安装器升级、重装代码时不会覆盖已有工具。手动安装的同名 gh 优先于随包版本，之后需由用户自行更新或删除该副本。

安装 CLI 后仍需登录 GitHub。管理员可通过 SSH 为实际运行账号交互式授权：

```bash
sudo -u rally-runtime -H /opt/rally/current/bin/gh auth login --hostname github.com --web
sudo -u rally-runtime -H /opt/rally/current/bin/gh auth status --hostname github.com
```

登录配置默认位于 `/var/lib/rally/.config/gh`，升级代码会保留；不要登录到 root 的配置目录或把 Token 发到聊天中。Rally 的专用 GitHub 工具复用运行账号的登录，使用非交互模式，不会自行弹出登录流程。

## 升级与备份

安装新版本前下载并核验对应 Release，在客户端确认当前任务、后台作业和文件传输已经结束或可以中断，再运行新版 `install.sh`。安装器会停止旧服务，将 `/etc/rally`、`/var/lib/rally`、`/var/lib/rally-control` 备份到 `/var/backups/rally/pre-版本-时间.tar.gz`，切换版本后重新启动并检查运行时。重复安装同版本会拒绝覆盖。用户自行配置在数据目录之外的工作区需另行备份。

升级后检查服务日志与设备重连。安装失败不会自动回滚；先查明原因。要回退时停止两个服务，恢复与旧版本匹配的数据和密钥，再将 `/opt/rally/current` 切回保留的旧版本并启动。禁止只回退二进制却继续使用已发生不兼容迁移的数据。

首次安装和升级都不会覆盖已有密钥。请将配置、业务数据和控制台数据作为一套备份；缺少 `/etc/rally/vault.key` 会导致原连接器凭据无法解密。管理密钥轮换可在服务器本机生成新随机密钥写入原文件，保持 `root:rally-control`、`0640` 权限，再重启 `rally-control`。

云端客户端不提供服务器交互终端、私有端口代理或系统通知。普通外链在 Windows 客户端应用内打开，在 Android 默认浏览器打开。Worker 浏览器运行在服务器，客户端通过任务卡片观看并接管，因此服务器 localhost 页面也可通过该画面查看。

## Agent 浏览器与网站账号

所有 Worker 共用 `/var/lib/rally/.rally/agent/browser-profile` 登录态，每任务独立窗口，最多 3 个任务同时占用；后续任务排队。运行时登记浏览器进程，任务结束关闭所属页面和临时下载，服务重启清理遗留进程，旧控制权不恢复。二进制来自当前安装包的 `browser/`，不在首次任务中在线下载。

浏览器卡片每 3 秒刷新，滚出视口或进入后台暂停；展开后默认观看，接管后可点击、输入中文、滚动、切换标签和交还。断线或退出视图进入等待，15 秒无心跳失去控制；必须重新接管后主动交还。吊销设备会立即解除其控制权。

网站账号通过主对话的私密表单填写，存于 `agent/website-accounts.txt` 密文库，复用 `/etc/rally/vault.key`。申请 24 小时后过期，关联任务/run 结束后也不接受提交；重复提交返回已有状态。Worker 只拿账号引用，宿主核对精确网站 origin 后填写。设置支持修改、停用和删除；这些操作不注销已有登录态。单独的“清除浏览器登录态”会在所有浏览器任务结束后删除共享网站数据，账号库保留。Chromium profile 的 Cookie/Storage 不由此 txt 加密；安装器自动备份排除该 profile。需保留登录态时，由管理员在服务停止后单独处理该敏感目录。

小磁盘维护：发布包和解包目录可在安装验证后删除；只在服务停止且确认不再使用后删除旧版本目录。保留当前 `browser/` 与账号/profile 数据，不把它们当测试缓存。开发验证使用独立临时目录并清理浏览器、npm 缓存及临时库；完成后运行 `df -h /` 核对空间。

## HTTPS 代理与附件传输

保留 Rally 监听 `127.0.0.1:4711`，在已有 HTTPS 站点中将请求代理到它。以下 Nginx 片段放在配置好证书的 `server` 内，按自己的域名与证书路径配置 TLS：

```nginx
location / {
    proxy_pass http://127.0.0.1:4711;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
    client_max_body_size 2m;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;
    # 默认 combined 日志记录查询参数；预览 URL 含短期只读票据，避免将其写入日志。
    access_log off;
}
```

客户端每次最多上传 1 MiB 字节块，Android 原生桥将块继续分为 256 KiB；单文件上限 1 GiB 不意味着需要允许 1 GiB 请求体。JSON API 仍有 1 MiB 限制。不要在代理层移除 Authorization、X-Rally-Instance、X-Rally-Protocol、Range、If-Range 或响应 CORS/Content-Range 头；不要缓存 `/v1/`。

预览票据仅授权单个资源的 GET/HEAD，有效期 2 分钟；设备吊销会撤销票据并关闭活跃字节传输。不要用日志、长期链接或公开文件目录替代接口。Windows 与 Android 的设备凭据由原生层持有。

修改代理后先执行 `nginx -t`，确认再重载。用测试设备上传和下载一个大于 1 MiB 的文件，检查重试、跨端预览、音视频定位与取消；仅 `/health` 返回 200 不足以验证附件链路。

## 完整数据备份与迁移

主要路径：

| 路径 | 内容 |
| --- | --- |
| `/var/lib/rally/.rally` | 供应商配置、事件、任务、会话、记忆、资源库 |
| `/var/lib/rally/.rally/resources` | 附件 SQLite 元数据、incoming 和按 SHA-256 保存的原件 |
| `/var/lib/rally/rally` | 默认工作区；自定义目录另行备份 |
| `/var/lib/rally-control` | 实例和已配对设备数据、幂等请求记录 |
| `/etc/rally` | 管理密钥、vault 加密密钥、监听配置 |

停止两个服务后再整体备份，可避免遗漏 SQLite WAL 或复制到半条事件。示例在服务器本机执行，备份目录只对 root 开放：

```bash
sudo systemctl stop rally-control rally-runtime
sudo install -d -m 0700 /var/backups/rally
sudo sh -c 'umask 077; tar -czf "/var/backups/rally/manual-$(date +%Y%m%d-%H%M%S).tar.gz" -C / etc/rally var/lib/rally var/lib/rally-control'
sudo systemctl start rally-runtime rally-control
```

迁移到新服务器时先安装相同代码版本，停止新服务器服务，按原路径恢复这三部分数据，检查用户/组拥有权与 `0640` 密钥权限，然后启动。不要把新安装产生的密钥混入旧数据，也不要让两台实例同时写同一数据目录。新 URL 需要客户端重新验证连接；没有完整恢复控制台实例和设备库时应重新配对。

附件资源的引用恢复在启动清理之前执行；损坏的事件会停用自动资源回收。普通文件在新系统上缺失时不会通过文件名猜测重建。升级/迁移后检查旧消息附件、任务产物、模型配置、设备重连以及一轮测试文件收发，再继续运行真实任务。
