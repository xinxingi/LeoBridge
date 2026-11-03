# VPS准备与目录迁移验收

本文保留准备阶段记录；后续本机容器及VPS私有部署结果见[容器验收](container-acceptance.md)和[VPS私有记录](vps-private-acceptance.md)，下文当时未执行项不代表当前进度。

日期：2026-11-02至11-03（Asia/Shanghai）。当前交付是开源源码、可审查的VPS部署工件及本地验证；测试VPS由用户后续提供。**待部署验收，未上线。** 本文将本地合成运行、既有真实前台证据及尚未执行的环境检查分开。

## 目录与来源

主代理审阅并整合各子任务，统一修改源码导入、脚本、测试、Vite根目录和构建路径。`src/`按中立模型、上游、协议、主题、管理、应用组合和运行时分层，`web/`保留可信管理界面与两套主题，`deploy/`放部署工件；一个package和锁文件不变。固定参考源码没有改动，主题来源/许可证/补丁记录随副本保留。

研究包括Uptime Kuma、Beszel、VS Code固定提交的少量相关文件及[用户分享讨论](https://chatgpt.com/share/6ae8a310-03d0-83ec-8ff2-b946a22f703a)。共享页面在浏览器超时后通过已授权本地代理读取；没有将其中建议当成操作授权。研究来源及取舍见[项目结构研究](project-structure.md)，最终边界见[架构](../development/architecture.md)。

构建后两套内置包的内容ID与迁移前相同，ID由协议及每个资源的路径/摘要计算：

| 主题 | 内容ID | 资源数量 |
| --- | --- | --- |
| CFSM默认前台 | `ce289c1a317516371a473c7f9604b334` | 311 |
| Adhesive Note | `89f37d966bcea82777c126e00cbc0313` | 288 |

目录迁移未改变这两套前台构建字节；本轮没有新增浏览器截图或重新宣称前台验收。既有真实首页、详情、历史、实时、主题管理浏览器记录保留在[双生态验收](dual-store-acceptance.md)和[CFSM验收](acceptance.md)。合成HTML只验证运行时路由，不能代替这些实际前台证据。

## 本地实际执行

使用Node24及pnpm11.25.0，依赖版本和锁文件未变化。主代理实际执行：

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm check` | 通过，156项测试、0失败；32个源模块依赖边界/循环检查、根项目及Komari前台类型检查、两前台与Node构建全部通过 |
| `pnpm build:worker` | 通过，保留适配器编译兼容；本轮未执行workerd、云端网络或部署 |
| `pnpm test:runtime` | 源码入口的Node proxy合成集成通过（也包含在完整测试中） |
| `BRIDGE_TEST_BUILT_NODE=1 pnpm test:runtime` | 实际`dist/node.js`子进程同一集成通过，正常退出码0 |
| Compose合成配置 | `docker compose config --format json`通过；核对应用不发布端口、nginx固定地址与可信范围、HTTPS源、JSON配置及环境替换范围；缺少必要配置明确失败 |

完整检查日志保存在忽略目录`work/private/vps-final-check.log`，Compose脱敏摘要为`work/private/vps-compose-summary.json`。本地证据不是仓库运行依赖；自动化测试源随项目交付，普通测试不会读取真实`.dev.vars`或主动访问真实主控。

交付检查扫描810个Git候选文件：真实源URL/主机、Token、管理/展示密码、私有绑定名称及ID均0命中，扫描仅输出数量与类别，不输出值。33份自有Markdown文档的91个本地文件链接全部存在，`git diff --check`通过。该扫描只验证已知本机私密值，不等于完整安全审计。

收尾再次运行`pnpm typecheck`通过，并将本地开发实例重启到当前`dist/node.js`。健康页200、展示入口307；最初对IP URL尝试覆盖Host的Node fetch检查返回404，随后用curl的`--resolve`保留实际管理URL复核返回200。未将第一次404算作通过，且没有修改路由来绕过源隔离。这次仅检查本地入口，没有读取新的真实主控指标或执行浏览器验收。

Node运行测试使用临时目录、合成主控及合成主题清单，启动真实Node子进程并通过HTTP/WS访问，覆盖：

- proxy单端口的HTTPS Host路由、根307跳转、独立登录、Secure/HttpOnly/host-only cookie及退出撤销。
- 未知Host、缺少或错误转发协议、非法WebSocket握手被拒绝；单元测试补充不可信代理、重复头、伪造客户端地址及IPv4/IPv6边界。
- CFSM历史范围、源查询下标与单位转换、实际零值；CFSM和Komari各自收到变化的合成原生WS观察。
- 主题切换不改变旧版本协议，重启保留active/previous/generation与退出状态。
- SIGTERM关闭上下游连接并退出，重复信号幂等；环境加载测试确认proxy默认忽略开发文件、显式文件解析及环境变量优先级。

构建入口复验应在`pnpm build`后运行。CI配置包含完整检查、构建入口集成、显式Worker构建及本地Docker镜像构建，不包含镜像发布或部署。**GitHub托管CI尚未执行。**

## 部署工件检查与未执行项

主代理审阅Dockerfile、Compose、nginx模板、systemd模板及白名单构建上下文。nginx只替换公开`BRIDGE_`域名变量，保留自身`$host`等变量；应用不接受任意客户端的转发头。Node以非root身份、私有持久卷和单实例方式运行。部署文档覆盖域名/TLS、独立访问策略、备份恢复及升级回退，不包含虚构的已发布镜像。

本机有Docker CLI 29.8.2和Compose 5.5.0，但所选OrbStack上下文的daemon socket不存在。因此以下均**未执行，不记为通过**：

- Docker镜像构建、Linux容器启动、只读根文件系统及卷权限的实际运行。
- nginx配置加载、真实TLS证书、HTTPS跳转及WSS转发。
- systemd单元启动、安全限制和重启行为。
- VPS网络、DNS、上游真实连通、浏览器和容量/长时间运行。
- 在容器卷中的实际备份恢复、镜像升级及应用回退。

没有启动用户的容器虚拟机，没有连接真实VPS，也没有修改主控配置、服务器顺序、服务状态或密钥。Workers云端部署同样未执行，优先级后置。

## 下一步

用户完成源码审查并提供测试服务器后，再明确目标环境和执行授权，按[VPS指南](../deployment/vps.md#目标vps验收与排障)逐项执行上述未完成检查。记录每种主题的首页、详情、系统/Ping图表、原生上游WS与HTTP回退，区分安装、兼容及故障；不以接口200或本地合成通过替代服务器实际验收。
