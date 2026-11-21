# Rally Linux 服务端

本包包含固定版本 Node、Agent 运行时、部署控制台和运行依赖。无需 Electron、源码构建或全局 npm 安装。当前已验证 Ubuntu 22.04 x64；需要 systemd、curl，以及任务实际使用的 git、Python 等外部工具。

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

## 升级与备份

安装新版本前下载并核验对应 Release。运行新版 `install.sh`，安装器会停止旧服务，将 `/etc/rally`、`/var/lib/rally`、`/var/lib/rally-control` 备份到 `/var/backups/rally/pre-版本-时间.tar.gz`，切换版本后重新启动并检查运行时。重复安装同版本会拒绝覆盖。用户自行配置在数据目录之外的工作区需另行备份。

升级后检查服务日志与设备重连。安装失败不会自动回滚；先查明原因。要回退时停止两个服务，恢复与旧版本匹配的数据和密钥，再将 `/opt/rally/current` 切回保留的旧版本并启动。禁止只回退二进制却继续使用已发生不兼容迁移的数据。

首次安装和升级都不会覆盖已有密钥。请将配置、业务数据和控制台数据作为一套备份；缺少 `/etc/rally/vault.key` 会导致原连接器凭据无法解密。管理密钥轮换可在服务器本机生成新随机密钥写入原文件，保持 `root:rally-control`、`0640` 权限，再重启 `rally-control`。

云端客户端首版不提供用户交互终端、内嵌浏览器、私有服务预览或系统通知。Worker 的 shell、文件、作业、MCP 和定时任务仍在服务器运行。
