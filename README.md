<p align="center">
  <img src="src/renderer/src/assets/rally-mark.png" alt="Rally" width="160" />
</p>

<h1 align="center">Rally</h1>
<p align="center">有点记性，有点本领，还想多帮你一点。✨</p>

Rally 是一个开源的 24/7 AI个人助手。陪你聊聊想法，也能打开浏览器、整理文件、写写代码，把事情往前推一推。任务多了，就叫上几位 Worker 一起搭把手。

名字、头像、性格、模型，都由你来选。慢慢相处，把它变成你喜欢的样子。

🌱 本项目在 [LinuxDo](https://linux.do/) 社区积极交流开发。感谢佬友们的认可与支持，一起把 Rally 养大！

## 一起做点什么？

- **把琐事交过来**：查资料、处理文件、操作网页，过程和结果随时可看。
- **帮你记着**：记住偏好，按约定定时办事，下次接着聊。
- **给工具箱添点宝贝**：用 Skills、MCP 扩展能力，也能接入生图、搜索、飞书、QQ 和邮箱。

> “每天早上帮我整理一下新资料，挑重点告诉我。”
>
> 好呀，交给 Rally。你先去喝杯热的。☕

## 把 Rally 带回家

从 [Releases](https://github.com/WEP-56/Rally-agent/releases) 下载：

| 你的小窝 | 怎么住进去 |
| --- | --- |
| Windows | 安装 `*-setup.exe`，在本机运行，或连接自己的服务器。 |
| Android 8+ | 安装对应手机架构的 APK，连接自己的服务器。 |
| Linux 服务器 | 按 [部署指南](deploy/linux/README.md) 安装，让电脑和手机共享同一个 Rally。 |

第一次见面，跟着引导选择运行方式、配置自己的模型服务，再给它起个名字。云端连接需要在服务器控制台为每台设备生成接入密钥。

小提醒：Rally 会实际执行命令、修改文件，目前没有命令级沙箱。记得备份重要资料；模型请求会发往你配置的服务。

## 想再多了解一点？

[使用与开发文档](docs/README.md) · [连接聊天与邮箱](docs/Connector/README.md) · [构建与发布](docs/发布指南.md)

遇到小毛病，或冒出好点子，欢迎来 [Issues](https://github.com/WEP-56/Rally-agent/issues) 留言。

感谢 [Pi](https://github.com/earendil-works/pi) 和它的贡献者，让 Rally 有了出发的底气。项目采用 [MIT](LICENSE)，第三方组件遵循 [各自的许可](THIRD_PARTY_NOTICES)。

## 想要开发一个 Personal agent，推荐你看看
- [Anthropic - always on agents](https://claude.com/resources/articles/building-always-on-agents)：24/7 个人助手与coding agent的关键区别
- [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype)：我认为，superagent 的思路是让 Personal agent 可以一个会话尽可能无限畅聊的核心架构。顺便，你可能需要一个激进的上下文压缩策略。
- [WEP](https://taoran.weppp.cyou/posts/personal-agent)：我对 Personal agent的一些理解。欢迎观看😳
- GROK bot、Muse、Hark、Today 等商业化项目，试试从它们的嘴巴里“翘”出来点好东西。
- 连接器！抱歉，开源社区在这里无法做到尽善尽美😔，那是企业私有的东西