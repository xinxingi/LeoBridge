# LeoBridge

让妙妙屋X的数据，使用 CF-Server-Monitor 和 Komari 的主题展示。

LeoBridge 只读访问妙妙屋X探针 API，转换服务器状态、历史和实时协议，并提供独立的主题管理站。采集、服务器管理和历史保存仍由妙妙屋X负责，无需安装新的 Agent。

**当前优先支持 Linux VPS 部署。** 两个内置主题已完成本地真实数据与浏览器验收；本机 Docker/nginx 合成验收，以及 VPS 私有实例的真实接口、实时更新、重启和备份恢复检查已通过；该 VPS 的浏览器验收与公网 DNS/TLS 仍待完成。Cloudflare Workers 保留为后续方向，本轮不部署。

## 可以做什么

- 使用 CFSM 默认前台或 Komari Adhesive Note 查看首页、详情、系统历史和 Ping 图表。
- 在独立后台浏览两个主题商店，安装固定版本、隔离预览、启用和回退，无需重新部署。
- 切换后旧页面保留原主题资源及协议；管理会话与第三方主题按主机名隔离。
- 优先接收上游原生 WebSocket；故障时明确显示过期或通过真实 HTTP 读取回退。

兼容结论只覆盖经过适配的两个内置包。商店安装成功不等于实测兼容。缺失指标显示未知，历史空缺不补点；服务器身份必须通过显式绑定校验。[兼容范围与限制](docs/research/compatibility.md)

## VPS 部署

推荐 **Docker Compose + nginx + 持久卷**。当前没有公开预构建镜像，请从审查过的源码构建。

需要 Docker Engine、Compose v2，以及管理、展示、版本和预览所需的 DNS 与 TLS 证书。不同用途的主机名是主题隔离的一部分，详细示例见 [VPS 部署指南](docs/deployment/vps.md)。

```sh
cd deploy/docker
cp .env.example .env       # 仅首次；已有配置不要覆盖
chmod 600 .env
# 在编辑器中填写上游、独立密码、域名、证书路径及身份绑定
docker compose config --quiet
docker compose build --pull app
docker compose up -d
```

应用容器以非 root 用户运行，不向宿主发布后端端口；只信任指定 nginx 代理。主题包、安装记录和管理状态保存在持久卷。部署指南包含首次配置、健康检查、备份恢复、升级、回退及可选 systemd 模板。

## 本地开发

需要 Node.js 24 和 pnpm 11.25.0。已有 `.dev.vars` 时保留它，不重复生成身份绑定。

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars   # 仅首次
# 编辑 .dev.vars，填写已授权主控地址及探针 Token
pnpm configure                  # 首次只读生成绑定，随后人工审查
pnpm configure:admin            # 独立管理密码只写入本机配置
pnpm check
pnpm dev
```

- 展示入口：[127.0.0.1:8787](http://127.0.0.1:8787)
- 管理入口：[admin.localhost:8786](http://admin.localhost:8786)
- 预览：从管理站打开对应主题。浏览器需要支持 `*.localhost`。

管理凭据保存在本机 `.dev.vars`，不要提交或公开。主控 Token 只保护上游；展示站的 `local/public/private` 策略与管理登录分别配置。完整变量及身份维护方法见 [配置参考](docs/configuration.md)。

## 项目结构

```text
src/        中立模型、上游、协议、主题、管理、应用组合与运行时
web/        独立管理界面及两套固定版本主题源码
deploy/    Docker/nginx 与 systemd 部署工件
scripts/    构建、配置、架构检查与只读验收工具
tests/      核心、协议、管理及运行时测试
docs/       用户指南、开发说明、决策与研究证据
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
| 查看实际通过与未验证项 | [开发进度](docs/progress.md) · [容器验收](docs/research/container-acceptance.md) · [双生态验收](docs/research/dual-store-acceptance.md) |
| 了解源码来源与许可 | [第三方声明](THIRD_PARTY_NOTICES.md) |

## 许可与反馈

LeoBridge 原创代码采用 [MIT](LICENSE)。CFSM、Adhesive Note 及其字体/图形保留各自许可证、固定来源与补丁记录，不以项目许可证覆盖第三方条款。

普通问题请附版本、运行方式和脱敏后的复现步骤。安全问题与敏感信息的处理见 [安全说明](SECURITY.md)。不要在 issue 中粘贴主控地址、Token、管理密码、身份绑定或原始响应。
