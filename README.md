![LeoBridge — 一份探针数据，两种主题体验。妙妙屋X桥接 CFSM / Komari。](docs/assets/readme-banner.png)

# LeoBridge

让妙妙屋X的数据，使用 CF-Server-Monitor 和 Komari 的主题展示。

LeoBridge 只读访问妙妙屋X探针 API，转换服务器状态、历史和实时协议，并提供独立的主题管理站。采集、服务器管理和历史保存仍由妙妙屋X负责，无需安装新的 Agent。

## 可以做什么

- 通过商店按需安装 CFSM 或 Komari 主题，使用桥接协议展示状态与历史；具体展示能力取决于主题兼容性。
- 在独立后台浏览两个主题商店，安装固定版本、隔离预览、启用和回退，无需重新部署。
- 默认一个端口：`/` 展示探针，`/admin/` 管理；主题切换后刷新首页生效。需要主题源隔离时可显式选择isolated模式。
- 优先接收上游原生 WebSocket；故障时明确显示过期或通过真实 HTTP 读取回退。

项目默认不内置第三方主题，首次启动显示安装引导。既有验收结论只覆盖历史适配包，不能转移到商店原版。商店安装成功不等于实测兼容。缺失指标显示未知，历史空缺不补点；服务器身份必须通过显式绑定校验。[兼容范围与限制](docs/research/compatibility.md)

## 部署

LeoBridge 以 Node.js 服务运行，可直接部署或使用 Docker。上游连接、身份绑定和访问策略见[配置参考](docs/configuration.md)；安装、HTTPS 接入、持久化及升级步骤见[VPS 部署指南](docs/deployment/vps.md)。当前没有公开预构建镜像，Docker 部署需从源码构建。

## 本地开发

需要 Node.js 24 和 pnpm 11.25.0。已有 `.dev.vars` 时保留它，不重复生成身份绑定。

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars   # 仅首次
# 编辑 .dev.vars，填写已授权主控地址及探针 Token
pnpm configure                  # 首次只读生成绑定，随后人工审查
pnpm configure:admin            # 可选：将初始管理凭据写入本机配置
pnpm check
pnpm dev
```

- 展示入口：[127.0.0.1:8787](http://127.0.0.1:8787)
- 管理入口：[127.0.0.1:8787/admin](http://127.0.0.1:8787/admin)
- 预览：从管理站打开对应主题，与默认站点共用端口；浏览器需要支持 `*.localhost`。已有独立源配置保留原模式，设 `BRIDGE_ROUTING=single` 可切换。

默认管理用户名为 `admin`，初始密码为 `admin`；已有自定义初始密码继续有效。首次登录必须设置12–128位、包含大小写字母、数字和符号的新密码，完成前无法使用管理功能。改密后全部旧会话失效，使用新密码重新登录。密码以加盐摘要持久化在状态存储中，重启不会恢复默认密码；`BRIDGE_ADMIN_PASSWORD` 仅在尚未改密时生效。初始配置和状态备份不要提交或公开。主控 Token 只保护上游；展示站的 `local/public/private` 策略与管理登录分别配置。完整变量及身份维护方法见 [配置参考](docs/configuration.md)。

## 项目结构

```text
src/        中立模型、上游、协议、主题、管理、应用组合与运行时
web/        LeoBridge 自有管理界面（不含第三方主题）
deploy/    容器、反向代理及服务管理配置示例
scripts/    构建、配置、架构检查与只读验收工具
tests/      核心、协议、管理及运行时测试
docs/       用户指南、架构、协议契约与第三方参考资料
```

目录和依赖规则见 [架构说明](docs/development/architecture.md)。项目保持一个依赖锁文件；中立模块不能导入具体协议，两种协议不能互相导入，Node 专用能力放在运行时层。`pnpm check`自动检查这些边界、循环依赖、类型、测试和构建。

## 文档

| 我想要… | 从这里开始 |
| --- | --- |
| 部署到 VPS、备份、升级 | [VPS 部署](docs/deployment/vps.md) |
| 配置上游、身份、访问策略 | [配置参考](docs/configuration.md) |
| 安装、预览与切换主题 | [主题管理](docs/themes.md) |
| 排查历史、身份或实时问题 | [排障](docs/troubleshooting.md) |
| 开发、测试或贡献代码 | [贡献指南](CONTRIBUTING.md) · [架构](docs/development/architecture.md) |
| 了解兼容范围与数据限制 | [兼容说明](docs/research/compatibility.md) |
| 了解源码来源与许可 | [第三方声明](docs/references/retired-themes/README.md) |
| 使用项目 Logo 与横幅 | [品牌素材](docs/assets/README.md) |

## 致谢

感谢以下开源项目及其作者、贡献者，为 LeoBridge 的双生态主题适配提供基础：

- [CF-Server-Monitor（CFSM）](https://github.com/huilang-me/CF-Server-Monitor)：提供默认前台、主题规范与主题生态。
- [Komari](https://github.com/komari-monitor/komari)：提供公开展示协议、主题机制与主题生态。

同时感谢 [Adhesive Note](https://github.com/stqfdyr/komari-theme-adhesive-note) 的作者与贡献者，为早期 Komari 适配提供主题基础。相关来源、版本与许可证见 [第三方声明](docs/references/retired-themes/README.md)。

## 许可与反馈

LeoBridge 原创代码采用 [MIT](LICENSE)。第三方主题、依赖、字体及图形保留各自来源与条款，本项目 MIT 不覆盖这些内容。商店收录、安装成功和兼容性验证均不代表获得授权；LeoBridge 展示可获得的许可信息，不判断某次使用是否符合上游条款。详见 [第三方声明](docs/references/retired-themes/README.md)。

项目默认不随产品交付第三方主题，由管理员通过商店按需安装。安装前展示来源、固定版本和可用许可文件；未找到时提示“未发现明确许可文件”，用户主动勾选后才能安装。确认只记录知情后的安装决定，不是授权证明；包安全检查和兼容性验证独立执行。[安装流程与迁移说明](docs/themes.md#主题获取与许可信息)

普通问题请附版本、运行方式和脱敏后的复现步骤。安全问题与敏感信息的处理见 [安全说明](SECURITY.md)。不要在 issue 中粘贴主控地址、Token、管理密码、身份绑定或原始响应。
