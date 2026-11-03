# Komari 展示协议实现与证据

日期：2026-11-02。实现 profile：`komari-adhesive-8ac4fd2`。本文记录代码和自动化验证，不代替主代理的真实浏览器、真实主控及 Workers 验收记录。

## 固定消费者和上游核对

- 实际验收主题：Adhesive Note v1.0.0，`stqfdyr/komari-theme-adhesive-note`，固定提交 `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`，MIT。应用副本和许可由前台任务保存在 `web/themes/komari/`。
- 实际消费证据：该提交 `src/api/queries.ts`、`src/api/types.ts`、`src/lib/rpc2.ts`。该主题优先复用 `/api/rpc2` WebSocket，按请求 ID 收取 JSON-RPC 2.0 响应；无法连接时用同路径 HTTP POST。心跳是无 ID 的 `rpc.ping` notification。
- Komari 核心参考：`komari-monitor/komari@96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f` 的 `web/rpc/jsonrpc/public.go`、`common.go`、`web/api/ws.go`、`protocol/v2/jsonrpc.go`、`database/models/models.go`、`web/router/router.go`。仅作只读协议参考，桥接器不运行 Komari 后端或 Agent。
- 未复制无许可证的 `komari-monitor/komari-web` 为应用，不能用核心 MIT 代替前端仓库授权。

## 已实现的独立输出协议

| 方法 | 返回形状与关键语义 |
| --- | --- |
| `public:getNodesInformation` | 节点数组；`uuid` 为显式绑定 ID；容量为 bytes，地区为旗帜 Emoji；隐藏名称不透出 |
| `common:getNodesLatestStatus` | 默认 `{uuid: flatStatus}`；指定 `uuid` 返回单个 flatStatus，指定 `uuids` 返回筛选 map；CPU 真 0 保留，不复制核心中旧 WS 把 0 改成 0.01 的行为 |
| `public:getPublicSettings` | 站点标题、真实历史保留范围及 `bridge` 能力；不暴露上游地址、Token或上游任意 HTML |
| `public:getClientRecentRecords` | 嵌套 Report 数组；仅当前桥接进程实际观察到的在线样本，最多每节点60点/10分钟；无旧数据时不补造 |
| `public:getRecordsByUUID` | `{count,records}`；时间为 ISO8601、内存/磁盘为 bytes、速度为 B/s；每点容量取该点真实值，不用当前静态总量回填 |
| `public:getPingRecords` | `{count,records,tasks}`；稳定数值任务 ID 由源端 target key 派生并检测碰撞；显式全超时为 `value=-1`，无数据不作为失败点 |
| `public:getPublicPingTasks` | 桥接器显式配置的展示目标；无目标地址、IP或敏感参数 |
| `public:getVersion` / `public:getMe` | 明示 LeoBridge/profile；Komari 管理身份始终 Guest，不把展示站 Basic Auth 冒充管理登录 |
| `rpc.ping` | 有 ID 时正常响应，无 ID 时不回包 |

JSON-RPC2 支持受限批量请求及标准无 ID notification。未实现方法返回 method-not-found；错误参数、源端故障、关闭探针、身份歧义均返回明确错误，不能用离线或空数组冒充成功。禁止的 Agent、管理、终端、执行和写入方法不转发。

为同 profile 中使用旧公开读接口的主题，另提供 `/api/nodes`、`/api/public`、`/api/me`、`/api/version`、`/api/recent/:uuid`、`/api/records/load`、`/api/records/ping`、`/api/task/ping` REST 形状及 `/api/clients` 的文本 `get` / `get UUID` 嵌套 Report 协议。这些接口的合成测试不代表所有第三方主题已通过兼容验收。

## 中立数据边界

`model.ts` 把妙妙屋X当前值转换为 `UnifiedServer`；`series.ts` 负责妙妙屋历史访问、秒到毫秒、系统事实和 Ping 桶语义。两者都使用 bytes、B/s、百分比、可空事实及源端 target key。

`history.ts` 是中立历史到 CFSM 字段/MiB 的投影；`komari.ts` 是中立模型/历史到 Komari bytes/ISO日期的投影。Komari 不读取 CFSM JSON，不把 CFSM `batchUpdate` 改字段冒充 Komari 响应。两生态复用同一身份检查、上游访问及历史查询流程。

历史查询在前后重新获取公开快照并核对整组稳定 ID 顺序；顺序变化丢弃结果。缓存30秒、最多100组，缓存读取仍校验当前身份；同请求并发合并。Komari 的4小时等窗口取足够大的已验证源端档位再裁剪，不插值。源端缺乏原子稳定 ID 查询造成的 ABA 限制继续适用，详见兼容清单。

## 明确偏差与限制

- 未知系统数值返回 `null`，真0保持0；离线来自源端显式状态。上游不可达返回错误；数据过期为 `online=null` 与 `bridge.stale=true`，不能标成服务器离线。前台补丁按这些事实展示缺失/故障。
- 当前累计流量、月流量、流量增量、GPU、Swap、温度、进程等未建立可靠源端口径，返回未知或明确不支持；不使用计费套餐数据冒充网卡总流量。
- 源端 Ping 为聚合桶，未提供逐包计数。记录携带 `loss_percent` 和 `aggregation=source_bucket`；任务摘要 `loss` 是可用桶百分比的算术平均，**不是可还原的逐包总丢包率**。`total` 是有数据桶数，`interval` 是输出桶宽，不声称为实际探测频率。前台已增加独立丢包图，不按负 RTT 数量推造丢包百分比。
- 节点未知安装/创建日期、价格、到期、物理核心数等不伪造；显式绑定 ID不等于上游真实数据库 UUID。
- 当前近实时缓存不是历史数据库；重启即清空。真实长期历史仍只来自妙妙屋X。

## 连接与访问控制

`komari-realtime.ts` 为每个展示连接保留一条只读主控 WS，接收真实快照并填充共享 Upstream 缓存；RPC 请求读取同一缓存，缓存过期时进行真实 HTTP 回退并标注 `bridge.transport=poll`，源 WS 新帧标 `websocket`。主控45秒无帧重连，退避1至30秒；访客10分钟连接续期。访客关闭后清理定时器、上游连接及迟到响应，迟到握手即关闭；每连接最多8个在途 RPC。

展示站访问控制仍由服务端 `authorize` 执行，包括 RPC POST、静态页与 WS 握手；POST 有 Origin 检查，WS Origin 由运行环境检查。展示权限不授予管理权限，Token仅放在配置主控的服务端请求头中。

## 验证状态

- 合成自动化已覆盖中立单位、Komari真实形状、0/缺失/离线/过期、名称隐藏、任务身份、Ping聚合、4小时真实档位查询、RPC权限/notification/batch/错误、历史、不支持指标、连接/HTTP回退/恢复/迟到清理及身份拒绝。
- 中立历史抽取后，既有 CFSM 历史和服务回归继续通过。
- 真实主控、真实主题浏览器及本地 Workers 验证由主代理统一整合执行；没有因此文把未执行检查标为通过。

### 真实主控经本机 Komari RPC2 的只读复验

2026-11-02，`scripts/verify-komari.ts` 对运行中的本机独立 Komari 预览源完成只读检查；不读取主控配置或 Token，通过本机端口及 Host 路由访问桥接器。所有原始响应仅保存忽略的 `work/private/komari-acceptance/2026-11-02T13-41-03-147Z/`。

- nodes/settings/latest/recent 均返回合法 JSON-RPC2：11台节点、11台在线，明确7天能力；recent为桥接实际观察到的样本。
- 1小时系统历史12点，Ping历史96点、8个显式任务，时间跨度均约0.917小时。
- 7天查询系统历史54点、跨度106小时，Ping历史424点、跨度104小时。查询支持7天不代表当前源端已经存满7天；没有补点或补齐跨度。
- WebSocket握手101，16.19秒内4个合法 `common:getNodesLatestStatus` 响应、0个RPC错误：2个不同原生上游WS观察、2个HTTP回退，测量字段内容实际变化。比较排除了时间、uptime等随时间推导字段。
- 该首次完整运行由验收脚本主动 `terminate` 清理，故原始摘要 close_code 为1006；不是源端异常证据。脚本随后改为1000优雅关闭，单独复核记录另存，保留原记录不覆盖。
- 优雅关闭复验 `work/private/komari-acceptance/2026-11-02T13-42-53-845Z/`：10.006秒内3个合法响应，3个不同原生WS观察、0个HTTP回退、0个RPC错误，实际测量内容变化，关闭码1000，无强制清理。
- 前两次尝试恰逢主代理重启本机服务，记录为 `ECONNREFUSED`，不是主控或协议失败。浏览器及 Workers 验收仍分别以主代理实际记录为准。
