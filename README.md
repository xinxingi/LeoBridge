![LeoBridge — 一份探针数据，两种主题体验。妙妙屋X桥接 CFSM / Komari。](docs/assets/readme-banner.png)

# LeoBridge

让妙妙屋X的探针数据，使用 CF-Server-Monitor 和 Komari 的主题展示。

LeoBridge 只读访问妙妙屋X探针 API，提供独立的 CFSM / Komari 展示协议和主题管理后台。采集、服务器管理和历史保存仍由妙妙屋X负责，无需安装新的 Agent。

## 功能

**网页配置数据源**：填写主控地址和 Token，检查连接、核对节点身份及 Ping 目标后保存。

![数据源设置：演示主控已连接并保存三个节点身份](docs/assets/screenshots/source-settings.jpg)

**双生态主题商店**：浏览 CFSM 与 Komari 主题，查看来源、固定版本和许可信息后按需安装。

![双生态主题商店：左侧 Komari，右侧 CFSM](docs/assets/screenshots/theme-stores.jpg)

**预览、切换与回退**：先预览再启用，保留已安装版本，切换主题无需重新部署。

**状态、历史与实时更新**：转换已有探针数据，缺失指标保持未知，历史空缺不补点；支持 WebSocket 和 HTTP 回退。

源码已补充[妙妙屋 X 原生主题](docs/research/native-theme.md)，通过原生API展示，使用同一安装、预览、切换及回退流程；此功能尚未包含在下方v0.2.0发行产物中。

项目默认不内置第三方主题。商店收录或安装成功不代表兼容，具体能力以[兼容说明](docs/research/compatibility.md)为准。

## 快速开始

当前版本为 **v0.2.0**，提供两种安装方式：

| 方式 | 获取产物 | 安装说明 |
| --- | --- | --- |
| Linux 运行包 | [GitHub Release](https://github.com/xinxingi/LeoBridge/releases/tag/v0.2.0)，选择 x64 或 arm64 附件 | [下载、校验与启动](docs/deployment/local.md) |
| Docker | [staractive/leobridge:0.2.0](https://hub.docker.com/r/staractive/leobridge/tags)，支持 amd64、arm64 | [Compose 部署](docs/deployment/docker.md) |

Release附件受GitHub仓库访问权限控制，私有仓库需先用有权限的账号登录；Docker Hub镜像可匿名拉取。

运行包下载并校验后解压，在解压目录中执行：

```sh
./leobridge.sh start
```

运行包自带运行环境，无需安装 Node 或 pnpm，启动时不会下载依赖或编译。默认后台运行，关闭终端后继续运行。用 `./leobridge.sh stop`、`restart`、`status`、`logs` 管理服务；加 `--quiet` 可隐藏正常输出。

1. 打开 [管理后台](http://127.0.0.1:8787/admin/)。全新安装且未自定义账号时，用 `admin` / `admin` 登录，按提示设置新密码并重新登录；已有实例使用当前已保存密码。
2. 进入「设置 → 数据源」，填写妙妙屋X主控地址和探针 Token。点击「检查连接」，核对节点身份与 Ping 目标后保存。
3. 进入 CFSM 或 Komari 商店，点击「查看安装」，在弹窗阅读来源与许可信息，勾选确认后安装主题。
4. 预览主题，确认显示正常后启用，打开 [展示首页](http://127.0.0.1:8787/)。

新用户无需预填主控地址或Token到配置文件。日后改密码、换主控都在后台操作，保存后立即生效；后台不会回写配置文件。运行包默认把这些状态保存在 `work/theme-store`，Docker保存在持久卷，重启和升级继续沿用。密码和数据源统一保存到同一个`state.json`，不读取环境变量中的初始配置，详见[配置在哪里修改和保存](docs/configuration.md#配置在哪里修改和保存)。

默认端口只供部署机器本机访问。在远程服务器部署时，先通过SSH隧道访问后台，或按[单域名反代](docs/deployment/reverse-proxy.md)配置HTTPS。展示、管理和预览默认同源，只应安装和预览可信主题。

需要修改代码或自行制作产物时，使用[开发构建指南](docs/development/build.md)。Cloudflare Workers仍为后续适配方向。

## 文档与贡献

[完整文档导航](docs/README.md)按安装使用、开发发布和协议依据分类。

| 需要做什么 | 文档 |
| --- | --- |
| 部署、备份或升级 | [Docker Hub镜像](docs/deployment/docker.md) · [运行包](docs/deployment/local.md) |
| 配置数据源、节点身份和访问策略 | [配置参考](docs/configuration.md) |
| 安装、预览、启用或回退主题 | [主题管理](docs/themes.md) |
| 了解兼容范围与数据限制 | [兼容说明](docs/research/compatibility.md) |
| 排查连接、历史或实时问题 | [排障指南](docs/troubleshooting.md) |
| 开发与发布版本 | [贡献指南](CONTRIBUTING.md) · [架构说明](docs/development/architecture.md) · [版本发布](docs/development/releasing.md) |

欢迎提交问题和改进建议。问题报告请附版本、运行方式和脱敏后的复现步骤；安全问题见[安全说明](SECURITY.md)。

## 致谢

感谢以下项目的作者与贡献者：

- [CF-Server-Monitor（CFSM）](https://github.com/huilang-me/CF-Server-Monitor)：提供前台、主题规范与主题生态。
- [Komari](https://github.com/komari-monitor/komari)：提供公开展示协议、主题机制与主题生态。

## 许可证

LeoBridge 原创代码采用 [MIT](LICENSE)。第三方主题、依赖、字体与图形遵循各自条款，来源及许可见[第三方声明](docs/references/retired-themes/README.md)。主题安装确认记录用户的知情决定，不作为授权证明；具体流程见[主题管理](docs/themes.md#主题获取与许可信息)。
