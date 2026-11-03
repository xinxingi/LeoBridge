# 开发进度

## 当前状态：VPS私有实例已运行，浏览器验收受权限阻塞

2026-11-03用户提供测试VPS并选择SSH隧道私有测试，明确SSH走本机7897代理。用户切换代理节点后，完整镜像传输和摘要校验通过。服务器现运行健康的单实例容器，18886/18887/18889均仅监听127.0.0.1，未开放公网展示；SSH隧道保持供本机访问。

| 当前检查 | 实际结果 |
| --- | --- |
| Docker构建/合成 | arm64及amd64镜像实际构建；主代理独立重跑42项Docker/nginx合成验收全部通过，包含HTTPS/WSS、private访问、应用IP变化恢复及600文件备份恢复 |
| 真实VPS | Debian13/x86_64，Docker26.1.5及Compose2.26.1；Node非root、rootfs只读、健康状态通过；一次采样内存约57MiB，不代表容量或长期稳定测试 |
| 真实CFSM | 11台；1h系统/Ping有效12行；7d有效系统61行、Ping60行；补充WS窗口3批原生消息并确认指标变化，关闭1000 |
| 真实Komari | 11台；1h系统12点、Ping96点/8目标；7d系统61点/120小时、Ping480点/118小时；原生2次观察和真实HTTP回退，指标变化及关闭1000通过 |
| VPS重启/恢复 | 启用Komari后重启，active/previous/generation保持；停写整卷备份到新卷，600文件路径/大小/SHA256全等；原卷保留。恢复后回退CFSM，两套资源/协议、管理及预览隔离12项复查通过 |
| 当前源码检查 | 新增配置准备工具及实时观察脚本类型检查通过；拒绝覆盖旧配置检查通过；原有156项工程测试为上一阶段记录，本轮不冒称重新执行 |
| 浏览器 | **未通过/受阻**：用户聊天授权及说明解除限制后，浏览器门禁仍拒绝根入口或固定主题域。未绕过权限、未用HTTP成功代替页面验收 |
| 未执行 | 公网DNS/公共TLS、systemd、跨应用版本升级/降级、GitHub托管CI及Cloudflare部署 |

本轮修复Docker动态池占用固定代理IP、nginx静态解析导致应用换IP后502；完整失败与成功证据见[容器验收](research/container-acceptance.md)。VPS恢复后一次HTTP检查出现ECONNRESET，应用健康且重启计数0，12项完整重跑通过；没有编造其根因。

[VPS私有测试记录](research/vps-private-acceptance.md)记录远端归档/镜像校验、真实数据范围、恢复与限制；[SSH指南](deployment/ssh-test.md)给出操作方式。服务器地址、root密码及源/管理秘密只保留在授权私有位置。817个Git候选文件已知源/管理凭据、绑定及测试目标地址0命中；36份自有文档108个本地链接收尾检查通过，`git diff --check`通过。

当前展示`http://vps-monitor.localhost:18887`，管理`http://vps-admin.localhost:18886`；管理凭据仅存本机`work/private/vps-test/management-credentials.txt`。服务器工作目录`/opt/leobridge-test`，当前卷`leobridge-ssh-test-restored-20261103`，原卷和私有整卷备份保留。不要使用root密码登录主题后台。

下一步是解除应用侧针对测试入口及版本子域的浏览器权限阻塞，再实际验收首页、详情、图表和刷新；之后再讨论正式域名/TLS与公开/私有策略。当前结论为“已部署SSH私有测试实例，接口和运维检查通过，整体验收未完成”，不是公开上线。

## 上一阶段：VPS部署准备完成

以下是准备阶段的历史状态，当前结果以文首为准。阶段更新时间：2026-11-03（Asia/Shanghai）。当时交付重点是开源项目与VPS部署准备；测试服务器由用户后续提供，本轮不连接服务器。**源码、部署工件与本地检查已完成；Docker镜像、nginx/TLS、systemd和真实VPS待部署验收。** Cloudflare部署后置；未推送、未发布镜像、未创建云资源。

本阶段完成：

- 参考Uptime Kuma、Beszel、VS Code固定版本及用户分享讨论，整理为`src/{core,upstream,protocols,themes,management,app,runtime}`、`web/`与`deploy/`；保留一个package和锁文件、上游来源及许可。增加TypeScript AST依赖边界、循环及Worker的Node依赖检查。
- README改为产品说明、VPS快速开始、本地开发与导航；详细配置、主题、架构、运维分别归档，补齐贡献、安全、MIT原创代码许可和第三方声明。
- Node增加显式proxy模式、单端口HTTPS反代、Host与可信代理校验、独立管理认证、进程健康检查及有界退出。生产反代模式默认不读取`.dev.vars`。
- 提供非root Docker构建、Compose/nginx TLS与WSS模板、私有持久卷、systemd备选及备份恢复/升级回退指南；CI只构建检查，不推送或部署。

| 本阶段检查 | 实际结果 |
| --- | --- |
| `pnpm check` | 通过：32个源模块架构检查、类型检查、156项自动化测试、两套前台及Node构建 |
| Node proxy合成集成 | 源码入口及`BRIDGE_TEST_BUILT_NODE=1 pnpm test:runtime`构建入口均通过；覆盖HTTPS源、管理会话、HTTP/WS拒绝边界、历史单位、两协议实时变化、切换、重启持久化及SIGTERM连接清理 |
| 目录迁移后前台资源 | 两套内置主题内容ID与迁移前相同；本轮未新增浏览器验收，既有真实前台证据见下文 |
| Compose配置 | 合成配置解析、必填项拒绝、后端不发布、固定代理IP及环境替换范围检查通过；没有读取真实配置 |
| Worker保留兼容 | 显式`pnpm build:worker`通过；本轮未再跑workerd或dry-run，未部署 |
| Docker / nginx / systemd / VPS | **未执行**：本机Docker daemon socket不存在，真实测试VPS尚未提供；不以Node合成代理替代这些验收 |
| 托管CI | 配置已更新；GitHub Actions未执行 |
| 交付内容检查 | 810个Git候选文件中真实源地址/主机、Token、密码、绑定名称及ID为0命中；33份自有文档的91个本地链接无缺失，`git diff --check`通过 |

详细范围、证据路径与复现命令见[VPS准备验收记录](research/vps-preparation.md)，使用入口见[VPS部署指南](deployment/vps.md)，目录理由见[开源项目研究](research/project-structure.md)与[架构边界](development/architecture.md)。已有`.dev.vars`与`work/private/`保持私有，不重复索取。

## 已有产品能力（上一阶段完成）

- 可运行TypeScript项目、固定pnpm依赖/锁文件、Node开发方式、Workers配置、CI、配置示例、README、排障与部署清单。
- 妙妙屋X只读访问、中立服务器/历史模型、CFSM协议、Komari RPC2/有限REST协议和运行环境分层。Token仅服务端，固定源origin并拒绝重定向；未新增Agent、完整主控后端或历史数据库。
- CFSM默认前台固定`609cc0b0998793510453be8eadced2064b28ad7d`；Komari真实Adhesive Note v1.0.0固定`8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`。源码、许可证、原文件摘要和必要补丁分别保留。
- CFSM `/api/config`、`/api/servers`、`/api/server`、`/api/history/all`、`/api/ws`；Komari JSON-RPC HTTP/WS按实际前台消费实现。首页、详情、历史、实时及本地资源齐备；未知值、实际0、离线、过期和源故障分别处理。
- 明确稳定桥接ID及描述条件，每次完整一对一匹配；历史前后校验整组顺序，歧义拒绝。源端仍缺不可变ID，无法排除ABA/完整复用描述条件，历史期间不改公开列表的约束继续适用。
- 真实`history_days=7`及system/Ping的`range=7d`已确认；按真实源时间/桶宽转换，不插值补点、不把容量或合并行数当每项指标完整七天。
- 独立认证管理源、CFSM与Komari两个目录、安装固定版本、隔离预览、启用和回退；无需改代码或重部署。目录刷新解析main→SHA，安装携带所见revision；每个安装hostname绑定对应资产及协议，旧页面保留原版本。
- 静态包验证来源/重定向/摘要/许可证/ZIP路径/大小/CRC及资源引用；不运行包内脚本。发现、可安装和实测兼容分开。实际安装的Emerald与官方Adhesive Note原包仍是未验证状态。
- Node私有文件、原子替换及锁；Workers R2不可变包和单站DO元数据/会话事务。DO仅用于主题管理一致性，没有D1或指标数据库。后台host-only会话、Origin/CSRF、退出撤销、generation冲突检查已实现。
- 原生源WS优先、退避重连、截止/过期、关闭清理和真实HTTP回退。单访客运输层故障不再清空跨协议共享缓存；无效数据/身份/隐私变化仍阻止迟到HTTP恢复旧数据。

## 双生态阶段检查与真实证据（保留历史）

以下143项测试和784文件扫描是上一阶段结果，当前检查以上表和VPS准备记录为准。CFSM默认前台、Komari Adhesive Note及双商店管理已完成本地真实数据与浏览器验收。原生WS有成功证据，也保留上游503和HTTP回退记录，不承诺源端长期可用或固定5秒节奏。

| 类别 | 实际结果 |
| --- | --- |
| 固定依赖 | 冻结锁文件离线安装通过；CI配置已提供，GitHub托管CI未运行 |
| 类型/测试/构建 | `pnpm check`通过：根项目及Komari前台类型检查、143项测试、两套前台/Node/Worker构建 |
| Worker打包 | 最终dry-run通过，333.72 KiB / gzip 81.37 KiB；未上传部署 |
| Workers合成 | 本地workerd、R2/DO模拟：管理、鉴权、CSRF/Origin、版本冲突、切换/回退、非零offset资源摘要、Komari历史和3次原生WS变化通过；CFSM版本路由/实时回归通过 |
| 真实CFSM | 首页11台、详情、1H/6H/7D图表、实时变化已浏览器验收。本轮并发修复后config/list/detail/1h/7d均200；7d系统55有效行、Ping54有效行，未填满七天 |
| 真实Komari | 实际主题首页11台、详情、1h/7d系统/Ping/丢包曲线及实时变化已浏览器验收；最终并发联调7d系统55点/108小时、Ping432点/8目标/106小时；原生2次不同观察及HTTP11次，关闭1000 |
| 主题管理浏览器 | 两个目录CFSM12/Komari64条；实际安装、预览、启用Komari、保留旧CFSM更新、回退CFSM、保留旧Komari更新；重启状态/会话持久化，revision固定后的重复安装仍返回原安装ID |
| 合成前台边界 | 两套前台的离线/零/缺省和图表检查；未以合成样例冒充真实主控边界证据 |
| 隐私扫描 | 784个Git候选文件中真实URL/主机、Token、管理/展示密码和私有绑定名称0命中 |
| Cloudflare云端 | **未执行，待部署验收**。真实云端HTTP/WSS、域名/TLS、R2/DO持久化和额度均须目标环境验收 |

详细证据：[双生态验收](research/dual-store-acceptance.md)、[Workers运行时](research/theme-runtime-acceptance.md)、[第一阶段CFSM记录](research/acceptance.md)、[真实源契约](research/upstream-contract.md)。原始响应只保存在Git忽略的`work/private/`；已有`.dev.vars`无需重复索取。

## 发现并修复的实际失败

1. 本地workerd管理登录两次500：跨请求复用DO stub违反workerd I/O生命周期。改为每次调用取得stub，完整真实workerd模拟复验通过；没有将其记作网络超时。
2. 多浏览器双协议历史503 `UPSTREAM_SUPERSEDED`：某个源WS断线使共享缓存revision失效。改为运输层只重连；源payload/身份失败继续失效。新增24项跨协议回归，由主代理审阅并统一执行；保持多页面运行并并发重跑CFSM/Komari历史通过。失败目录`2026-11-02T14-14-29-571Z`，成功分别为`bridge-acceptance/2026-11-02T14-24-56-245Z`及`komari-acceptance/2026-11-02T14-24-56-796Z`。
3. 本轮CFSM两个90秒窗口仅收到真实HTTP回退更新，未观察到原生帧。一次直接限时WS诊断得到上游HTTP503；原因未确认，不能推断为鉴权或连接数限制。既有CFSM原生两批更新及Komari本轮原生成功证据保留；下游回退通过不算这两个窗口的原生WS通过。
4. 清理合成服务时重复退出信号导致undici连接池重复关闭异常；Node退出改为幂等并处理已关闭连接池。独立合成实例连续SIGINT/SIGTERM验证：3个监听端口启动、退出码0、stderr为空，证据`work/private/shutdown-check/result.json`。
5. 本地直连曾TLS/HTTP超时，授权7897代理后Node真实HTTP/WS可用；本地workerd真实源网络仍曾504，Wrangler CLI检测到代理不代表workerd出站使用代理。

## 保留限制

- 实测兼容仅覆盖两个适配后的内置包；不承诺商店全部主题兼容。未提供主题自定义配置/卸载/孤立包清理UI，managed使用默认值，raw/redirect配置拒绝。
- 第三方主题与管理源隔离，CSP限制同源资源/连接；静态校验无法代替每个包实际浏览器验收。
- 每访客一条上游连接；Node上限50，Workers尚无跨isolate共享限流。源WS已观察到503；公开规模及共享连接方案需结合目标上游限制评估，不宣称高并发或长期稳定已验收。
- 真实离线、隐藏、关闭采集、重排/改名没有通过更改主控制造；这些边界以合成测试验证实现。主控及Agent具体版本未知。
- 本轮末次浏览器复查可读取页面和变化指标，但截图/日志/关闭等部分工具接口返回不可用；没有据此声称新增截图或清理成功。此前的实际图表截图检查与应用无error日志记录保留。

## 准备阶段本地交接（历史）

本地Node已用本轮`dist/node.js`重新启动：展示`http://127.0.0.1:8787`，管理`http://admin.localhost:8786`，预览从管理界面打开。重启后健康页200、展示入口307，使用实际管理主机名复核首页200；这次入口检查没有读取主控指标，也不算新的浏览器验收。管理密码私存在`.dev.vars`，未输出；当前启用CFSM，上一版本Komari，保留4个安装版本。重启按README运行。临时workerd及合成Node/上游服务已停止；上一阶段独立合成配置生成器和`--check`已执行通过，新生成目录从空本地state启动的29项端到端检查全部通过（`worker-themes/2026-11-02T14-40-38-731Z`），启动步骤见Workers运行时验收文档。

该阶段之后用户已提供测试机并授权SSH私有测试；当前结果和下一步以文首及VPS私有测试记录为准。没有修改真实主控配置、服务器顺序、服务状态或密钥。
