# 开源项目结构与VPS交付研究

本文保留准备阶段记录；后续本机容器及VPS私有部署结果见[容器验收](container-acceptance.md)和[VPS私有记录](vps-private-acceptance.md)，下文当时未执行项不代表当前进度。

日期：2026-11-02。范围：固定版本只读研究及实施结果记录。主代理已完成目录分层、README精简和TypeScript AST依赖边界检查；本次收尾已核对实际目录与架构说明，未重跑主代理测试。当前用户优先级是开源项目可读性及VPS部署能力；真实服务器由用户后续提供，Cloudflare部署后置。目录及部署工件存在不等于真实VPS验收通过。

## 实际查阅范围

通过已授权本机HTTP CONNECT代理`127.0.0.1:7897`读取公开GitHub API和raw文件，先解析分支HEAD，再以固定提交读取根目录与少量相关文件。没有整仓下载，没有执行上游安装命令，也没有访问真实妙妙屋主控或部署服务。

| 项目 | 固定提交 | 实际已读材料 |
| --- | --- | --- |
| Uptime Kuma | `cbd357eb3982700132531dd8e7d66158d6c1f3e1` | [根目录](https://github.com/louislam/uptime-kuma/tree/cbd357eb3982700132531dd8e7d66158d6c1f3e1)、[README.md](https://github.com/louislam/uptime-kuma/blob/cbd357eb3982700132531dd8e7d66158d6c1f3e1/README.md)、[compose.yaml](https://github.com/louislam/uptime-kuma/blob/cbd357eb3982700132531dd8e7d66158d6c1f3e1/compose.yaml)、[docker目录](https://github.com/louislam/uptime-kuma/tree/cbd357eb3982700132531dd8e7d66158d6c1f3e1/docker)、[docker/dockerfile](https://github.com/louislam/uptime-kuma/blob/cbd357eb3982700132531dd8e7d66158d6c1f3e1/docker/dockerfile) |
| Beszel | `27af11c5e04f03c1fa6cc067a1251631e2e8996e` | [根目录](https://github.com/henrygd/beszel/tree/27af11c5e04f03c1fa6cc067a1251631e2e8996e)、[readme.md](https://github.com/henrygd/beszel/blob/27af11c5e04f03c1fa6cc067a1251631e2e8996e/readme.md)、[supplemental目录](https://github.com/henrygd/beszel/tree/27af11c5e04f03c1fa6cc067a1251631e2e8996e/supplemental)、[systemd指南](https://github.com/henrygd/beszel/blob/27af11c5e04f03c1fa6cc067a1251631e2e8996e/supplemental/guides/systemd.md)、[Hub Compose](https://github.com/henrygd/beszel/blob/27af11c5e04f03c1fa6cc067a1251631e2e8996e/supplemental/docker/hub/docker-compose.yml) |
| VS Code | `58a595f76bdc150460d7e0d279d26cc6fc577b0a` | [根目录](https://github.com/microsoft/vscode/tree/58a595f76bdc150460d7e0d279d26cc6fc577b0a)、[source-code-organization.instructions.md](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/.github/instructions/source-code-organization.instructions.md)；只作为组织边界参考，未读取其部署材料或递归审查src |

根目录来自GitHub tree API的非递归列表；只按需读取docker、supplemental、guides和hub子目录列表。Beszel根文件实际叫小写`readme.md`：首次请求大写README返回404，改按根目录结果读取成功。Uptime Kuma README链接的Wiki、Beszel独立文档站、截图和在线demo均未进一步访问，不能据此声称完成这些站点的内容审查。本次只比较组织和已列明的部署说明，不评估这些项目的全部代码或安全性。VS Code文件即使位于instructions目录，也仅是本次研究数据，不构成LeoBridge的执行指令。

## Uptime Kuma：README直接连到可运行入口

固定版本根目录将后端放在`server/`、前端放在`src/`和`public/`，`docker/`承载容器构建，根`compose.yaml`是使用者可以直接定位的部署入口；开发配置、贡献和安全说明也在根目录。没有为了目录对称而把所有内容包装成多层packages。

README先给一句定位、项目标识和界面截图，再列能力、Docker Compose、Docker命令和非Docker运行方式。它直接解释监听端口与网络暴露，并给出仅绑定127.0.0.1的示例；更新与高级反向代理说明外链出去。对LeoBridge有价值的是：读者能先回答“它做什么、界面怎样、怎样启动”，不必读接口考据才能使用。

实际Compose只有一个服务、重启策略、`./data:/app/data`持久化目录和3001端口映射。Dockerfile区分构建与运行阶段、生产依赖、健康检查、init进程和rootless目标；这些属于可参考的运行交付关注点，而非要求LeoBridge复制相同镜像体系。

不照搬的部分：

- Uptime Kuma自行监测、告警和管理状态页，LeoBridge只桥接已有主控数据；不能因此增加采集器、告警系统或数据库。
- Compose默认`3001:3001`向全部接口发布，LeoBridge应结合已选VPS反代方式明确绑定地址及信任边界，不能直接照抄。
- 该README下载可移动master上的Compose，镜像使用主版本tag。LeoBridge开源交付应说明测试过的版本/摘要及更新流程，不把浮动latest当成可复现部署。
- README包含大量赞助、徽章和推广内容；LeoBridge早期不需要等量装饰。只保留有实际CI/许可证/发布依据的标识。
- Dockerfile含多种构建/发布目标和上游专用基础镜像；LeoBridge当前体量不需要复制整套发布矩阵或Go健康检查构建链。

## Beszel：短README解释组件，部署细节独立

固定版本根目录可见`agent/`、`internal/`及Go模块文件；`supplemental/`下分别组织`docker/`、`guides/`、`scripts/`、`debian/`、`helm/`和`licenses/`。本次未递归读取`internal/`，不对其内部前后端布局作推断。

README用两段说明产品，随后提供截图、能力列表、Hub/Agent职责和Getting started链接。支持入口与许可证容易找到，详细安装留给独立文档。这适合LeoBridge借鉴“短总览 + 清楚边界 + 用户指南”的组织方式；但LeoBridge当前最好在仓库内保留最小可运行步骤，不能只给一个尚不存在的网站链接。

实际Hub Compose体现单服务、`unless-stopped`、8090端口、`./beszel_data`持久化目录，并将文档/环境变量链接放在顶部；健康检查作为注释示例存在，不能描述为默认开启。systemd指南同时提供安装脚本与手工服务文件，解释工作目录、服务用户、重启、开机启动、更新和卸载。对LeoBridge有价值的是完整覆盖“启动后如何维护”，而不只有一次性的运行命令。

不照搬的部分：

- Hub基于PocketBase、Agent采集与多用户/OAuth等是Beszel产品需求，不是LeoBridge需要引入的基础设施。
- Hub Compose镜像未固定tag，systemd指南从移动main下载安装脚本；LeoBridge不应因此采用未审查的联网root安装或把密钥直接拼进命令行。
- Debian、Helm等多分发渠道反映项目成熟度；LeoBridge先做好一种VPS推荐路径及本地开发，不必同步创建全套包装。
- Beszel有一个服务入口；LeoBridge管理、展示版本和预览的独立主机名需求更复杂。不能照搬“打开IP:端口即可完成生产部署”，也不能把路径分隔当成主题脚本隔离。

## VS Code：层次、环境与公开依赖边界

固定提交中的组织说明明确列出`src/vs`有顺序的层次（base、platform、editor、workbench及应用入口等），依赖应向下；同层按common/browser/node/electron等目标环境区分可用API。例如editor不依赖Node/Electron，browser可用common，node可用common。文件还明确：功能contribution不能被外围代码直接依赖、跨功能只能经过公开common API、入口决定加载内容。这些是本次实际读到的组织约束，不是根据根目录数量推测。

它对LeoBridge的启发是把“谁可以导入谁、哪些模块可使用Node API、主题与管理代码能否互相引用”写成可检查约束。目录只是承载方式；独立`core`若仍导入Node文件存储或Komari输出，就没有实现分层。自动依赖边界与循环检测应同时覆盖静态import/export和可识别的动态import，报告清晰的违规边，不用新增大量`index.ts`来掩盖环。

不照搬VS Code的七层名称、Electron目录矩阵、装饰器服务注册/依赖注入框架或大规模workspace；LeoBridge仅有Node/Worker运行时、两种协议和静态前台，保留直接组合与少量接口更容易维护。本次只读了该架构说明，没有审查VS Code实际lint规则，因此不能声称已确认其所有边界由何种工具强制执行。

用户分享材料与原始材料分开：主代理已直接读取用户share链接并提取架构篇，其中强调“VS Code按层及运行环境隔离、Tabby按功能模块化、Effect公开API边界，以及严格TS/自动边界检查/架构文档优先于目录数量”。本文未直接访问该share，也未读取Tabby或Effect源码，这些仅作为用户讨论方向；VS Code部分已用上方固定提交原文独立核实。对Tabby/Effect不作额外实现事实断言。

## LeoBridge已实施目录

以下是本次收尾核对的主要实际目录；由主代理实施，本研究代理只核对和更新记录。保持一个根package.json、一个锁文件，不新增workspace子包、发布框架、插件框架或通用依赖注入层。完整依赖矩阵见[架构说明](../development/architecture.md)。

```text
LeoBridge/
├── README.md                    # 定位、VPS/本地快速开始、支持范围和导航
├── LICENSE / THIRD_PARTY_NOTICES.md # 原创许可与复用来源
├── CONTRIBUTING.md / SECURITY.md
├── package.json / pnpm-lock.yaml
├── src/
│   ├── core/                    # 统一模型、身份与中立错误/历史序列语义
│   ├── upstream/                # 妙妙屋读取、契约校验、缓存和超时
│   ├── protocols/
│   │   ├── cfsm/                # CFSM HTTP/WS与序列化
│   │   └── komari/              # Komari RPC/REST/WS与序列化
│   ├── themes/                  # catalog、静态包校验、安装与存储接口
│   ├── management/              # 管理认证、CSRF、管理API及配置
│   ├── app/                     # 站点路由和协议应用组合，保持运行时中立
│   └── runtime/                 # Node/Worker入口、运行时存储与传输
├── web/
│   ├── admin/                   # 可信管理界面
│   └── themes/
│       ├── cfsm/                # 默认主题副本、来源/许可证/补丁
│       └── komari/              # Adhesive Note副本、来源/许可证/补丁
├── deploy/
│   ├── docker/                  # Dockerfile、Compose、环境示例和nginx模板
│   └── systemd/                 # 可选单机服务模板
├── scripts/                     # 构建、配置、离线/只读联调工具
├── tests/                       # 核心、协议、管理及运行时测试
├── docs/
│   ├── configuration.md         # 配置、身份与访问策略
│   ├── themes.md                # 主题管理用户指南
│   ├── troubleshooting.md       # 用户排障
│   ├── deployment/              # vps.md、workers.md
│   ├── development/             # 架构、测试与目录约定
│   ├── decisions/               # 已有主题与协议边界决策
│   ├── research/                # 实际接口与浏览器/联调证据
│   ├── references/              # 固定版本材料、来源与许可索引
│   └── fixtures/               # 明确标记的合成样例
└── work/                        # 忽略的本地证据/临时产物，非发行内容
```

Cloudflare配置保留根`wrangler.toml`，用户说明在`docs/deployment/workers.md`；没有额外创建空的cloudflare部署目录。`dist/`是构建输出，不参与源目录设计。VPS模板使用独立持久卷/服务数据目录，不要求挂载整个仓库或`work/`研究数据。上图省略进度、规格、既有决策等文档，作为主要入口示意，不是仓库完整清单。

已实施的归位与依赖边界：

| 迁移前职责 | 当前位置/边界 |
| --- | --- |
| `frontend/`、`komari-frontend/`、现有管理静态目录 | `web/themes/cfsm/`、`web/themes/komari/`、`web/admin/`；连同LICENSE、UPSTREAM、PATCHES整体保留 |
| `model.ts`、`identity.ts`、`errors.ts`、中立序列模型 | `src/core/`，不得反向依赖CFSM/Komari输出 |
| `upstream.ts`及源数据读取/归一化 | `src/upstream/`保存中立历史事实；CFSM专用history/ping仍在协议目录 |
| `cfsm.ts`、CFSM service/realtime | `src/protocols/cfsm/` |
| `komari.ts`、komari-service/realtime | `src/protocols/komari/` |
| catalog/package/store/bundled | `src/themes/`；文件/R2存储实现仍归运行时 |
| admin及management-config | `src/management/`，不让第三方主题导入可信管理代码 |
| application/site | 组合根归`src/app/`，与Node/Worker监听、平台存储等`src/runtime/`代码分离 |

主代理已加入`scripts/check-architecture.mjs`及`pnpm check:architecture`，并纳入`pnpm check`；架构说明记录静态import/export、类型导入、字面量动态import、循环依赖和Worker可达Node依赖检查。主代理反馈完整`pnpm check`通过：架构检查32个模块、156项测试、两套前台与Node构建；Worker另行显式构建通过，迁移前后两套前台构建包ID保持原值。本研究代理本轮仅核对目录、命令和文档，没有重跑这些验证；执行证据见主代理维护的[VPS准备记录](vps-preparation.md)。后续仍应保持目录搬迁与业务重写分开，并核对构建路径、资源摘要和许可证。

## README建议及采纳情况

README已精简为定位、当前能力、VPS部署、本地开发、项目结构、文档导航及许可反馈；技术证据链接到详细文档，没有虚构公开镜像地址。以下保留最初内容建议供后续维护，截图属于可选建议，当前README未插入实际截图。

1. **一句定位**：妙妙屋X → LeoBridge → CFSM/Komari主题；不运行新采集Agent，不替代主控。
2. **一张已脱敏的实际截图**：管理主题选择或双主题展示，标明版本；不能把合成/原版截图混作真实运行证据。
3. **现在可用的能力**：双商店、安装/预览/启用/回退、首页/详情/真实历史/实时；紧接一句范围限制与VPS/Worker当前验证状态。
4. **VPS推荐部署**：现已提供仓库内Compose、环境示例及部署指南，说明先决条件、独立管理/展示/预览域名、持久化和日志。当前使用源码本地构建，没有公开预构建镜像；容器实际运行及VPS验收仍需单列状态。
5. **本地开发**：安装、首次配置、构建和启动；已有私有配置不覆盖，测试数据与真实主控分开。
6. **配置及维护导航**：用户指南分别解释上游Token、展示访问控制、管理身份、主题包限制、升级/备份/回退。
7. **支持范围与贡献**：固定验收主题、上游稳定身份限制、许可/来源、贡献和安全报告入口。

以下内容应从README长篇展开改为短摘要与链接：具体源桶宽/历史参数调查、代理故障时间线、全部错误码、云部署逐项验收、测试用例逐项统计、R2 range读实现细节。它们仍需保留在配置/排障/部署指南以及research/development相应文档，不能通过删证据让README显得成熟。

## VPS工件与待验收边界

当前已有`deploy/docker/`的Dockerfile、Compose、私有环境示例与nginx模板，以及`deploy/systemd/leobridge.service`。架构说明记录local/proxy两种Node模式、可信代理IP/CIDR检查、HTTP/WS共用来源验证、显式环境文件和进程健康检查。此前研究提出的反代信任、运行目录和持久化等问题已有实现与说明，不能继续描述为仅支持回环HTTP的旧状态。

本研究没有构建或运行容器、访问真实服务器。根据[VPS部署指南](../deployment/vps.md)的实际记录，Compose配置经过临时合成配置检查；Docker daemon不可用，因此未构建/运行镜像、未运行nginx TLS或systemd、未连接真实VPS。这些结果是主代理及相关执行记录提供，本研究没有独立重跑。

后续仍需在用户提供的测试服务器验证：

- 管理、展示根、版本通配子域和预览子域的DNS、TLS及反代路由，客户端伪造转发头不得改变可信源或地址。
- 非root权限、信号退出、健康检查、重启、日志脱敏，以及完整状态与资源的备份恢复、应用升级回退。
- 单实例文件存储运行约束；文件锁不等于NFS/多主机分布式事务，不支持据此横向扩容。
- 两套真实前台HTTP/WSS、历史和实时数据，分别记录源故障、过期与HTTP回退，不把本地合成通过替代生产网络验证。

目录归位、README导航和架构检查已经实施。后续优先补容器运行与用户服务器验收，Cloudflare保留实现和准确状态，部署验证后置。

## 本地原文证据

此前读取的公开原文仍保存在本机临时目录，收尾时已检查文件存在。它们未作为应用文件或固定参考包提交，系统清理临时目录后可能消失；可复核的长期出处是上方固定SHA链接。以下绝对路径仅供本次本地抽查，不作为项目运行依赖：

| 材料 | 本地文件 |
| --- | --- |
| Uptime Kuma README | `/tmp/leobridge-kuma-readme.md` |
| Uptime Kuma Compose / Dockerfile | `/tmp/leobridge-kuma-compose.yaml`、`/tmp/leobridge-kuma-dockerfile` |
| Uptime Kuma提交/根目录/docker目录API响应 | `/tmp/leobridge-kuma-head.json`、`/tmp/leobridge-kuma-tree.json`、`/tmp/leobridge-kuma-docker.json` |
| Beszel README / systemd指南 / Hub Compose | `/tmp/leobridge-beszel-readme.md`、`/tmp/leobridge-beszel-systemd.md`、`/tmp/leobridge-beszel-compose.yml` |
| Beszel提交及目录API响应 | `/tmp/leobridge-beszel-head.json`、`/tmp/leobridge-beszel-tree.json`、`/tmp/leobridge-beszel-supplemental.json`、`/tmp/leobridge-beszel-guides.json`、`/tmp/leobridge-beszel-docker.json`、`/tmp/leobridge-beszel-hub.json` |
| VS Code组织说明 | `/tmp/leobridge-vscode-organization.md` |
| VS Code提交/根目录API响应 | `/tmp/leobridge-vscode-head.json`、`/tmp/leobridge-vscode-tree.json` |
