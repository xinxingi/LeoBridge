# Komari 展示协议实现与证据

日期：2026-11-03。协议版本：`komari-rpc2-bed58b5`，支持官方默认前台及旧便签纸消费者。本文说明协议接口、数据转换和实现限制。

## 固定消费者和上游核对

- 旧版验收主题：Adhesive Note v1.0.0，`stqfdyr/komari-theme-adhesive-note`，固定提交 `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`，MIT。应用副本已移除，来源和许可保留在[历史档案](../references/retired-themes/README.md)。
- 实际消费证据：该提交 `src/api/queries.ts`、`src/api/types.ts`、`src/lib/rpc2.ts`。该主题优先复用 `/api/rpc2` WebSocket，按请求 ID 收取 JSON-RPC 2.0 响应；无法连接时用同路径 HTTP POST。心跳是无 ID 的 `rpc.ping` notification。
- Komari 核心参考：`komari-monitor/komari@96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f` 的 `web/rpc/jsonrpc/public.go`、`common.go`、`web/api/ws.go`、`protocol/v2/jsonrpc.go`、`database/models/models.go`、`web/router/router.go`。仅作只读协议参考，桥接器不运行 Komari 后端或 Agent。
- 历史官方前台固定 `komari-monitor/komari-web@bed58b589da63232a17681b1dbaed9eab2423078`，原应用副本已移除。无独立 LICENSE，保留 README 的二次开发说明并标为 NOASSERTION，不能用核心 MIT 代替前端许可。
- 官方消费者及限制见[前台契约](komari-frontend.md)，浏览器结果见[验收](komari-default-acceptance.md)。

## 已实现的独立输出协议

| 方法 | 返回形状与关键语义 |
| --- | --- |
| `common:getNodes` | 无uuid返回`{uuid: node}`，指定uuid返回单个node；仅当前公开绑定节点，不含管理字段 |
| `common:getVersion` / `common:getBackendVersion` | 与公开版本接口相同，标明 LeoBridge；后者兼容商店原包公开消费者调用 |
| `common:getPublicInfo` / `common:getMe` | 公共设置别名及明确未登录的访客身份，不伪造原生管理权限 |
| `common:getNodeRecentStatus` | `{count,records}`，仅实际观察到的近期样本，扁平字段；与旧public近期接口的嵌套Report形状区分 |
| `common:getRecords` | type=load按client分组，type=ping返回平铺记录及任务摘要；uuid可选，只遍历当前公开绑定节点，同一Komari服务的历史读取最多4路并发（跨RPC批次共享），任一路失败停止该请求继续出队并等待已启动任务收尾 |
| `public:listMetricDefinitions` | 支持的指标、单位与真实历史保留范围 |
| `public:queryMetrics` | 以 `entity_id/metric_keys/hours` 查询原始系统/Ping/丢包率源桶；不补点或重采样 |
| `public:getPingMetricStats` | 源桶RTT/丢包率摘要；total/valid保持null，未知的可选数值字段省略，sample_buckets标明有数据桶数，支持task_id/task_ids过滤，不伪造逐包统计 |
| `public:getNodesInformation` | 节点数组；`uuid` 为显式绑定 ID；容量为 bytes，地区为旗帜 Emoji；隐藏名称不透出 |
| `common:getNodesLatestStatus` | 默认 `{uuid: flatStatus}`；指定 `uuid` 返回单个 flatStatus，指定 `uuids` 返回筛选 map；CPU 真 0 保留，不复制核心中旧 WS 把 0 改成 0.01 的行为 |
| `public:getPublicSettings` | 站点标题、所选正式/预览主题的theme与theme_settings、真实历史保留范围及 `bridge` 能力；HTTP/WS按请求携带上下文，不暴露上游地址、Token或上游任意 HTML |
| `public:getClientRecentRecords` | 嵌套 Report 数组；仅当前桥接进程实际观察到的在线样本，最多每节点60点/10分钟；无旧数据时不补造 |
| `public:getRecordsByUUID` | `{count,records}`；时间为 ISO8601、内存/磁盘为 bytes、速度为 B/s；每点容量取该点真实值，不用当前静态总量回填 |
| `public:getPingRecords` | `{count,records,tasks}`；稳定数值任务 ID 由源端 target key 派生并检测碰撞；显式全超时为 `value=-1`，无数据不作为失败点 |
| `public:getPublicPingTasks` | 桥接器显式配置的展示目标；无目标地址、IP或敏感参数 |
| `public:getVersion` / `public:getMe` | 明示 LeoBridge/profile；Komari 管理身份始终 Guest，不把展示站 Basic Auth 冒充管理登录 |
| `rpc.ping` | 有 ID 时正常响应，无 ID 时不回包 |

JSON-RPC2 支持受限批量请求及标准无 ID notification。未实现方法返回 method-not-found；错误参数、源端故障、关闭探针、身份歧义均返回明确错误，不能用离线或空数组冒充成功。禁止的 Agent、管理、终端、执行和写入方法不转发。

为同 profile 中使用旧公开读接口的主题，另提供 `/api/nodes`、`/api/public`、`/api/me`、`/api/version`、`/api/recent/:uuid`、`/api/records/load`、`/api/records/ping`、`/api/task/ping` REST 形状及 `/api/clients` 的文本 `get` / `get UUID` 嵌套 Report 协议。这些接口的合成测试不代表所有第三方主题已通过兼容验收。

## 中立数据边界

`src/core/model.ts` 把妙妙屋X当前值转换为 `UnifiedServer`；`src/upstream/series.ts` 负责妙妙屋历史访问、秒到毫秒、系统事实和 Ping 桶语义。两者都使用 bytes、B/s、百分比、可空事实及源端 target key。

`src/protocols/cfsm/history.ts` 是中立历史到 CFSM 字段/MiB 的投影；`src/protocols/komari/adapter.ts` 是中立模型/历史到 Komari bytes/ISO日期的投影。Komari 不读取 CFSM JSON，不把 CFSM `batchUpdate` 改字段冒充 Komari 响应。两生态复用同一身份检查、上游访问及历史查询流程。

历史查询在前后重新获取公开快照并核对整组稳定 ID 顺序；顺序变化丢弃结果。缓存30秒、最多100组，缓存读取仍校验当前身份；同请求并发合并。Komari 的4小时等窗口取足够大的已验证源端档位再裁剪，不插值。源端缺乏原子稳定 ID 查询造成的 ABA 限制继续适用，详见兼容清单。

## 明确偏差与限制

- 未知系统数值返回 `null`，真0保持0；离线来自源端显式状态。上游不可达返回错误；数据过期为 `online=null` 与 `bridge.stale=true`，不能标成服务器离线。历史适配包按这些事实展示缺失/故障；商店原版的表现需独立验收。
- 原生`ping.loss`单位为ratio，源端百分比除以100；桥接扩展`ping.loss_percent`保留百分比，两者不可混用。
- common历史保留源端已聚合桶；maxCount/max_count不触发额外重采样，返回bridge.max_count_applied=false。绝对日期窗口暂不支持；start/end及start_time/end_time均明确返回范围错误。
- 当前累计流量、月流量、流量增量、GPU、Swap、温度、进程等未建立可靠源端口径，返回未知或明确不支持；不使用计费套餐数据冒充网卡总流量。
- 源端 Ping 为聚合桶，未提供逐包计数。记录携带 `loss_percent` 和 `aggregation=source_bucket`；任务摘要 `loss` 是可用桶百分比的算术平均，**不是可还原的逐包总丢包率**。`total` 是有数据桶数，`interval` 是输出桶宽，不声称为实际探测频率。历史适配包增加了独立丢包图，不按负 RTT 数量推造丢包百分比。
- 节点未知安装/创建日期、价格、到期、物理核心数等不伪造；显式绑定 ID不等于上游真实数据库 UUID。
- 当前近实时缓存不是历史数据库；重启即清空。真实长期历史仍只来自妙妙屋X。

## 连接与访问控制

`src/protocols/komari/realtime.ts` 为每个展示连接保留一条只读主控 WS，接收真实快照并填充共享 Upstream 缓存；RPC 请求读取同一缓存，缓存过期时进行真实 HTTP 回退并标注 `bridge.transport=poll`，源 WS 新帧标 `websocket`。主控45秒无帧重连，退避1至30秒；访客10分钟连接续期。访客关闭后清理定时器、上游连接及迟到响应，迟到握手即关闭；每连接最多8个在途 RPC。

展示站访问控制仍由服务端 `authorize` 执行，包括 RPC POST、静态页与 WS 握手；POST 有 Origin 检查，WS Origin 由运行环境检查。展示权限不授予管理权限，Token仅放在配置主控的服务端请求头中。

## 商店原包消费补充核对（2026-11-03）

Komari Emerald 1.0.16原包（ZIP摘要`f7fdf4f0af5849b425d7e1c4e91e50d39573c4de41136eb436e66cf8e5fe7794`）调用common:getPublicInfo/getNodeRecentStatus/getRecords等，不能只提供public命名空间。固定核心同一提交的common.record.go、common.go、register.go核对了默认common注册组、节点单项/字典形式、近期扁平记录、load分组和Ping平铺响应；public.metric.go与internal/metricstore/definitions.go核对了原生loss比例单位。修复针对公共协议，不改主题资源。

合成回归验证这些形状、任务筛选/全公开节点、0与null、访客身份及主题上下文；测试通过不是实际主题浏览器验收。未知数据显示仍取决于原主题的格式化函数，不将数值字段改为字符串“-”。


### Ping统计可选值与原生差异

固定Komari核心 `publicPingMetricTaskStats` 的 `min/max/avg/latest/p50/p99/stddev` 使用 `omitempty`。桥接对未知字段同样省略，不用null或0替代；真实零延迟及零丢包保留。没有有效桶的目标不生成stats项。丢包率未知时也不生成该目标的统计项，因为原生`loss`是必填数值，桥接无法真实补出；原始延迟仍由历史/指标接口提供。

固定核心的`p99_p50_ratio`没有`omitempty`，默认会输出0；桥接没有逐包分位数，不能把默认0当作真实比例，因此明确省略此字段。`total/valid`仍为null并以`sample_buckets`单独表示有效源桶数，不将桶数当作探测包数。这是公开保留的协议差异，不宣称完整统计兼容。
