# v0.1兼容清单、证据与限制

更新时间：2026-11-02（Asia/Shanghai）。当前对象是CFSM固定提交 `609cc0b0998793510453be8eadced2064b28ad7d` 的默认前台。**已实现**表示仓库存在代码；**真实证据**表示已对授权主控读取到对应结果；浏览器验收及Workers部署是另外的检查，不能互相替代。完整交付状态以 [开发进度](../progress.md) 为准。

本轮已继续实现双商店、动态管理及Komari，新增范围以[双生态验收](dual-store-acceptance.md)、[Komari协议](komari-protocol.md)和[主题前台](komari-frontend.md)为准。以下CFSM数据语义与源身份限制继续适用；“不提供管理”指CFSM源端管理接口，LeoBridge独立主题管理站已经实现。

## 接口与消费端

| 接口/资源 | 当前实现 | 真实证据与边界 |
| --- | --- | --- |
| `/api/config` | 桥接站配置、历史能力、指标限制及过期阈值；不复制源端appearance | 本地桥接真实主控联调200、结构通过 |
| `/api/servers` | `servers/stats/regionStats/sysConfig`；稳定桥接ID、显式在线状态、空值 | 本地桥接200，11台；真实隐藏/离线场景未人为制造 |
| `/api/server?id=…` | 从当前公开快照按绑定ID选取；缺少/未知ID明确报错 | 本地桥接200、结构通过；不使用数组下标作为外部ID |
| `/api/history/all?id=…&hours=…` | 系统与显式选定Ping目标按时间合并；前后检查身份；有限缓存 | 上游system/Ping四档均成功；授权代理后的最终Node构建1h/7d全部200，直连失败保留 |
| `/api/ws` | CFSM `hello/subscribed/ping/pong/batchUpdate`；上游快照转换；退避重连与HTTP回退 | 直连回退曾取得2个poll变化批次；代理后的最终Node构建收到2个原生websocket变化批次、poll0、close1000 |
| 首页、详情及静态资源 | 固定默认前台副本；`/#/`、`/#/server/:id`；同源assets、flags、os-icons、favicon | 实际浏览器首页、详情、1H/6H/7D曲线及实时更新通过；详见验收记录 |
| 管理入口 | 展示源`/admin`明确404，不支持CFSM源端写接口 | LeoBridge主题管理在独立管理源实现，不把第三方主题与管理会话放同源 |

前台保留上游Dashboard、ServerDetail、卡片、样式和Chart.js图表。应用副本在 `web/themes/cfsm/`，参考目录保持不变；来源摘要、MIT许可和差异见 [前台补丁清单](../../web/themes/cfsm/PATCHES.md)、[实际消费契约](frontend-contract.md)。关闭当前不支持的管理、地图、计费等入口；删除浏览器读取遗留CFSM令牌的逻辑。未承诺所有CFSM主题兼容。

## 数据转换

| 源端事实 | 桥接及CFSM行为 | 证据/限制 |
| --- | --- | --- |
| `cpu_pct` | 百分比；0保留，缺失/无效为未知 | 源文档、真实结构及转换测试；不是重新采集 |
| `mem_* / disk_*` | 中立模型byte，CFSM容量除以1024²为MiB | 已对照默认前台格式化消费 |
| `download_speed / upload_speed` | `net_in_speed / net_out_speed`，B/s不缩放 | 源文档与默认前台消费一致 |
| `cpu_threads` | 逻辑核心；不把物理`cpu_cores`无条件当逻辑线程 | 未知保持缺省 |
| `online` | 显式true/false/null优先 | 上游不可达、数据过期不是服务器离线 |
| `last_seen / uptime` | 离线源时间转毫秒；在线采用桥接观察时间；启动时间标记推算 | 不声称取得源端精确在线采样时间或开机时刻 |
| `region_country / region` | 已知国家编码/Emoji转地区代码；未知不编造 | 旗帜与OS图标本地资源 |
| Ping目标 | 显式key→CFSM槽位，不按数组位置或ISP唯一性推断 | 真实主控9目标；默认主题最多8槽，未选目标不展示 |
| Ping `-1` | 无数据；保持CFSM `false`/空点语义 | 不能改为0延迟；只有明确100%丢包且无有效RTT才表示超时 |
| `traffic_* / cumulative_*` | 累计、月流量和计费字段当前不映射，显示未知 | 计费用量为configured_period、来源xray；网卡/开机累计为current_boot。不同口径不得混用 |
| Swap/GPU/磁盘IO/进程等 | 未支持，不填0或编造历史 | 前台显示缺省值或空图并说明限制 |

## 历史能力与证据演进

早期文档摘录只列出1h/6h/24h，当时不是对当前主控上限的实测结论。后来快照返回`history_days=7`；本轮又实际取得`range=7d`的system和Ping成功响应，因此旧的“当前主控最多24小时”判断已被推翻。历史记录保留在 [真实联调记录](live-observations.md)，现行输入契约见 [upstream-contract.md](upstream-contract.md)。

| 源范围 | 桶宽 | 预期桶数 | 当前真实验证 |
| --- | ---: | ---: | --- |
| 1h | 300秒 | 12 | system、Ping均HTTP200、success=true |
| 6h | 600秒 | 36 | system、Ping均HTTP200、success=true |
| 24h | 1800秒 | 48 | system、Ping均HTTP200、success=true |
| 7d | 7200秒 | 84 | system、Ping均HTTP200、success=true；系统随采样推进为52–54点，并非完整七天 |

默认前台提供0.167/0.5/1/6/12/24小时；源声明至少7天时另提供48/96/168小时。小范围从已验证上档查询后裁剪，12h取24h、48h/96h取7d，不能由此获得更高采样精度。查询响应的`bucket_sec`必须匹配已核实档位，防止上游静默降档。当前不使用未逐档验证的2d至6d参数。

系统序列各字段为独立的`{t,value}[]`，`t`为Unix秒，转CFSM毫秒并按真实时间合并，不按数组位置拼接。7d的`buckets=84`是容量而非实际点数；早期本地桥接84合并行中系统有效53行、Ping有效52行，最终构建复验为54/53行，**不能把合并行数当成每指标七天完整采样**。前台通过`bridge.history_bucket_seconds`按真实桶宽判断断点，不能套用上游默认120点假设截断正常聚合曲线。

Ping的桶没有`t`，但授权主控实际加载的前台脚本已明确算法：

```text
timestamp_ms = (floor(generated_at / bucket_sec) * bucket_sec
                - (buckets.length - 1 - index) * bucket_sec) * 1000
```

算法来自真实消费者代码片段，并与system最后桶时间一致；不是猜测或插值。Ping无数据桶不变成测量点。脚本传输曾中断，材料摘要明确标记为片段，不声称完整源码版本已知。主控及Agent版本仍未知。

## 稳定身份及无法消除的限制

源接口不提供已确认的不可变服务器ID，历史参数仍为当前公开数组下标。桥接配置保存不透明稳定ID和**显式描述选择条件**；每次快照都重新一对一匹配并取得当前下标。名称不是隐含唯一键，可联合其他允许的公开属性，但这些属性也不是不可变ID。

- 每台公开服务器必须恰好匹配一项绑定；重复、重叠、缺少、未绑定或属性变化都明确失败，不静默映射。正常重排可保持桥接ID。
- 历史请求前后分别获取新快照并比较整组ID顺序；变化时丢弃结果并返回409。缓存读取仍校验身份。
- 改名、名称隐藏、配置/硬件变化、添加或移除服务器时需要审查选择条件；保留原桥接ID显式维护，不靠重新随机生成全部ID掩盖问题。
- 两次快照间重排再复原，或另一台完全复用同组描述属性，当前API无法区分。运行约束是**历史读取期间不改公开列表顺序或身份属性**；若无法满足，必须等待上游稳定公开ID及按ID查询接口。前后检查不是原子身份保证。

以上歧义/排序等行为可以用合成测试检查实现，但本轮没有更改真实主控来制造测试条件；合成通过不是这些真实情景已被观察。

## 实时、故障与访问策略

下游CFSM订阅格式为 `{type:"subscribe",scope:"all"或桥接ID,ids:[…]}`；消息中的`updates[] → serverId → samples[] → ts/data`保持固定版本消费者契约。上游WS是直接快照JSON，不可原样转发。

每访客一条上游连接，关闭传播并清理定时器；重连1秒退避至30秒，源帧45秒未完整到达则标过期并重连，10分钟更新连接。源WS连续15秒无完整快照时，每5秒尝试HTTP快照回退；同一进程/isolate复用3秒缓存和并发请求，不重叠轮询。只有真实HTTP读取成功才发成功数据；失败不回填旧快照。`batchUpdate.transport`和`bridgeStatus.transport`标识`poll`或`websocket`。

必须分开记录：

- **下游WS消息通过**：浏览器收到CFSM批量消息，来源可为HTTP回退。
- **上游原生WS通过**：必须确有`transport=websocket`帧；`poll`不能当成此项证据。
- **长期稳定与5秒节奏**：直连源WS两帧曾相隔约31秒；早期回退版本90秒收到2个poll变化批次、0个websocket批次。接入授权代理后45秒采到9个完整源帧（5种内容），最终Node构建7.594秒收到2个原生websocket变化批次、正常关闭。原生连续更新已有证据，但限时采样没有证明严格5秒节奏或长期稳定。

HTTP上游截止30秒；历史前快照→并行system/Ping→后快照通常最多三段，前台允许110秒。Node配置undici连接截止30秒本身不是网络故障修复证据；用户授权的7897代理接入后两轮完整Node真实验收通过。曾发生的TLS超时、HTTP502和无新帧均保留，见[代理观察](proxy-observations.md)。

上游Token只在服务端使用，只访问配置源且拒绝重定向。展示站有独立local/public/private策略；private认证覆盖HTML、资源、HTTP和WS，不能把源Token误当展示站访问控制。默认本机监听，远程公开必须显式配置；当前没有主控写管理API；独立主题管理接口另有认证。未知指标、离线、过期和上游故障分开呈现。

## 运行环境与后续产品

Node本地运行和真实主控HTTP/WS读取已有实际证据；CFSM前台实际浏览器验收由主验收记录确认。本地workerd、Worker打包/dry-run及Cloudflare云端部署分别记结果，**打包和本地运行都不是云端部署通过**。未推送或创建Cloudflare资源，Workers状态仍为待部署验收；VPS私有实例的后续真实结果见[VPS记录](vps-private-acceptance.md)。Workers到主控的实际云端鉴权、WS生命周期、历史和访问策略仍须目标环境验收。

本地workerd合成全链路通过；访问真实主控仍超时。Wrangler CLI检测到HTTP_PROXY/HTTPS_PROXY不代表workerd出站使用了该代理。需要本机代理时使用Node；生产Worker不导入Node代理模块，也不能使用本机127.0.0.1代理地址。

不使用D1、不持久化采集历史。新增单站DO仅用于主题元数据/启用事务/管理会话，R2存不可变静态包；它们不存实时采集数据库。Node设访客实时连接上限；Workers每访客一条源连接，尚无跨isolate共享限流。高流量公开站需要先评估连接规模、额度和共享方案，不能承诺无限并发。

双商店、安装/预览/切换/回退和真实Komari适配已完成本轮本地实现与验收。兼容状态绑定具体包摘要；不代表所有CFSM或Komari商店主题已兼容。见[产品规格](../spec.md)、[ADR 001](../decisions/001-theme-protocol-boundaries.md)、[双生态调查](theme-ecosystems.md)及[本轮验收](dual-store-acceptance.md)。

本轮并发修复及源WS503：运输层断线曾错误清空跨协议缓存，导致历史503；修复后双协议历史复验通过，新增24项回归。CFSM末两轮只有HTTP回退，直接源WS握手诊断得到503，原因未确认；这两轮没有原生WS通过证据。Komari同时有两次原生观察。不得用早期原生成功或下游消息通过掩盖本轮局限，详见[双生态验收](dual-store-acceptance.md)。
