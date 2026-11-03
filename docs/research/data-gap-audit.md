# CFSM / Komari 与妙妙屋X探针数据差异

核验日期：2026-11-03（Asia/Shanghai），最新复核约20:44。这里的“xapi”指妙妙屋X公开探针接口；“cmfs”按本项目的CFSM理解。范围是展示所需的公开节点、实时指标、历史与统计，不包括管理写接口、Agent上报、远程控制或告警执行。

结论：资源利用率、在线统计、连接数、基础Ping曲线、周期流量和续费展示大多已有基础字段；本次已补中立模型的数据准备与`bridge.data`扩展，详见[实现与验证](bridge-field-coverage.md#本次数据准备实现覆盖下文早先的未接入状态)。真正的缺口集中在稳定身份、Swap、GPU、磁盘IO、进程数、虚拟化、精确采样/探测明细，以及更完整的历史和流量账本。**“桥接器目前返回null”不能证明“妙妙屋接口没有这个数据”。**

当前三个协议的实际接入状态及原生页面核对另见[桥接字段覆盖](bridge-field-coverage.md)：原生协议已保留价格、周期/开机流量、回程、解锁等；这些项目现已进入CFSM/Komari扩展输出，标准字段及主题显示不在本次继续适配范围内。

## 20:44 主控补充信息后的复核

重新调用同一真实源，前后快照及单台system/Ping的1h/7d共6次GET全部200，历史success=true。与20:34基线比较，新增返回`renewal_price`、`renewal_currency`、`renewal_price_cny`和`unlocks`；其余快照字段集合与覆盖台数未变，所抽查历史字段和点数未变。

| 项目 | 20:34 | 20:44最新结果 | 分类修正 |
| --- | --- | --- | --- |
| 续费原币价格/币种/CNY折算价 | 0/11 | 7/11均为有效金额/ISO币种，且有续费周期 | 已有基础数据，可计算这7台的成本与续费汇总；另外4台仍未知 |
| 解锁检测`unlocks` | 未返回 | 7/11非空，共28条；均有service/status/tested_at，结构还含region | 从“仅固定消费者声明”更新为“真实接口已提供”；不等于所有服务均解锁成功，须按各条status展示 |
| CPU型号 | 8/11 | 8/11 | 3台仍未返回型号 |
| 服务商 | 2/11 | 2/11 | 9台仍未返回服务商 |
| 系统/Ping历史 | 系统11项、Ping9目标 | 字段与点数未变 | 历史load、逐包统计等仍未观察到 |

此次价格和解锁信息恢复符合用户补充主控信息后的变化，能够确认“此前缺值并不等于接口没有能力”；未读取主控内部配置，不能进一步断言每个剩余缺值的具体原因。稳定ID、Swap、GPU、磁盘IO、进程、虚拟化等仍未出现在本次公开响应中，保持“未提供/未观察到”，不推断后端是否支持采集。

复核证据：`work/data-gap-audit/recheck-1-summary.json`、`recheck-1-diff.json`、`recheck-1-value-check.json`；原始响应另存`work/private/data-gap-audit/recheck-1/`，20:34基线未覆盖。未修改桥接实现、主控配置或用户状态；没有执行WS、主题浏览器、构建或部署复验。

## 扫描范围与证据

| 来源 | 本轮检查内容 |
| --- | --- |
| CFSM `609cc0b0998793510453be8eadced2064b28ad7d` | 固定API文档、公开dashboard实现及默认前台契约；`/api/config`、`/api/servers`、`/api/server`、`/api/history/all`、`/api/ws` |
| Komari核心 `96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f` | 固定节点/历史模型、公开RPC与common RPC实现、指标定义；节点信息、最新状态、近期记录、系统/Ping历史、指标查询与Ping统计；HTTP/WS均使用`/api/rpc2`，另有旧REST兼容接口 |
| 妙妙屋X在线文档 | 本轮浏览器重新读取[探针API](https://miaomiaowux.com/docs/probe-api/)与[流量统计口径](https://miaomiaowux.com/docs/traffic-accounting/)，页面均标注更新于2026-10-31 |
| 妙妙屋固定原生前台 `723427b18ea23a59a923a89155ebe1f3fa3fa824` | `ProbeServer`、`ProbePayload`、Ping/连接/流量类型；这是消费者证据，不是主控后端源码 |
| 已授权真实妙妙屋源 | 2026-11-03约20:34取得前后两份快照，11台公开节点；当前下标0的system与Ping各查询1h、7d，6次GET均HTTP200且结构有效，历史均`success=true`。通过本机7897 SOCKS5代理，无直连回退 |
| 当前LeoBridge代码 | 中立模型、系统历史归一化、CFSM/Komari适配器，区分“已有源字段”和“已完成接入” |

本轮没有启动真实CFSM/Komari后端，没有重新验收主题浏览器或WS；这是一份字段审计，不是新增兼容声明。历史仅抽查一台，不能推广为11台历史均完整。前后公开描述属性及顺序一致，但仍不能消除数组下标的ABA身份竞态。主控与Agent具体版本未知。

本地脱敏扫描结果：`work/data-gap-audit/live-summary.json`、`value-check-summary.json`；原始响应仅存忽略目录`work/private/data-gap-audit/`。公开报告不记录地址、凭据、节点名称或具体资源用量。

## 1. 基础数据已提供，可直接映射或计算衍生指标

“已提供”区分真实返回与文档/固定消费者声明；可选字段缺省时仍应显示未知。本次实现状态以[桥接字段覆盖](bridge-field-coverage.md)文首为准；可计算不表示能够复原源端没有返回的历史。

| 数据/衍生展示 | 妙妙屋基础字段 | 对应CFSM / Komari | 计算方法、当前覆盖与限制 |
| --- | --- | --- | --- |
| CPU利用率 | `cpu_pct` | `cpu` / `cpu` | 直接百分比映射，11/11有效；真0保留。不能据此恢复每核利用率 |
| 内存已用、总量、剩余、占用率 | `mem_used, mem_total` | `ram_used/ram_total` / `ram/ram_total` | 剩余=`total-used`；占用率=`used/total×100`，总量须>0；11/11。CFSM容量转MiB，Komari保持byte。差值不等于Linux的`MemAvailable` |
| 磁盘容量、剩余、占用率 | `disk_used, disk_total` | `disk_used/disk_total` / `disk/disk_total` | 同上，11/11；容量无法推导磁盘IO |
| 实时上/下行与总网速 | `upload_speed, download_speed` | `net_out_speed/net_in_speed` / `net_out/net_in` | B/s直接映射，可相加或对公开节点求和；11/11。网速始终来自系统网卡，不能用来核算Xray套餐 |
| 1/5/15分钟系统负载 | `loadavg` | `load_avg` / `load,load5,load15` | 解析前三项，11/11；按逻辑CPU数归一化可作为另一个明确命名指标，不能把CPU占用率当作负载；历史另见第2类 |
| CPU型号、物理核心候选、逻辑线程 | `cpu_model,cpu_cores,cpu_threads` | `cpu_info,cpu_cores` / `cpu_name,cpu_physical_cores,cpu_cores` | 型号8/11，核心与线程11/11。CFSM及Komari的逻辑核字段应使用`cpu_threads`；`cpu_cores`已有源字段，可作为物理核心候选，精确定义仍需Agent证据，不可仅凭命名断言物理拓扑 |
| OS、内核、架构、地区 | `os,kernel,arch,region_country,region` | `os,kernel_version,arch,region` / 同类节点字段 | 11/11；国家码/旗帜可互转，公开地区可聚合计数。国家/城市名不能还原精确经纬度 |
| 在线/离线、节点与地区数量 | `online,servers[]` | `is_online`、列表统计 / `online`、节点列表 | 对公开列表计数即可。未知状态单列；上游故障/数据过期不当成离线。只能统计公开节点，不能推断隐藏总量 |
| 运行时长、估算开机时间 | `uptime`；离线可有`last_seen` | `boot_time` / `uptime` | `观察时间-uptime`可估算开机时间；11/11有uptime。本次全在线，未返回`last_seen`符合文档，不是字段缺失；不能把观察时间当Agent精确采样时刻 |
| TCP、UDP与连接合计 | `tcp_connections,udp_connections,conn_history` | `tcp_conn,udp_conn` / `connections,connections_udp`等 | 11/11；common最新状态的`connections`为TCP+UDP。固定Komari指标定义中的Connections描述为TCP，不能把同一合计无条件用于所有接口。源TCP口径为ESTABLISHED，UDP为socket，不能扩成全状态TCP或“代理用户连接数” |
| Ping当前值、分桶曲线、丢包曲线 | `ping[].key,current_ms,loss_pct,buckets`；Ping历史 | `ping_*/loss_*` / Ping records、`ping.latency/ping.loss` | 可映射目标及曲线；Komari原生loss比例需百分比÷100。抽查9个目标；CFSM仅8个展示槽，槽位限制是输出协议限制。目标使用key明确绑定；`-1`无数据不当作0延迟或丢包 |
| 分桶级别的延迟/丢包摘要 | 桶`ms,loss` | 主题图表摘要 / 部分Ping统计 | 可计算“桶均值的最小/最大/平均”“有效桶数”“桶丢包率均值”，必须保留这个命名与口径；不能冒充逐包min/max、加权平均、探测次数或p99 |
| CPU、内存、磁盘、速率、连接数历史 | `probe-series?metric=system`各独立`{t,value}[]` | `/api/history/all` / records、queryMetrics | 本次1h每项12点、300秒桶；7d每项65或66点、7200秒桶，预期84桶，不是已采满7天。按时间对齐、保留缺口。区间较短可裁剪，不能增加采样精度 |
| 开机累计网卡上下行/合计 | `boot_traffic_up/down,boot_traffic_scope`，以及`cumulative_up/down,cumulative_traffic_scope` | `net_tx/net_rx` / `net_total_up/down`的候选来源 | 11/11，scope均`current_boot`。可准确展示“本次开机网卡流量”；和目标累计字段是否同一网卡、重置口径仍须核对。当前桥接未接入，不属于完全无源数据；不能冒充跨重启累计或月流量 |
| 当前计费周期用量、限额、剩余、占比 | `traffic_used,traffic_limit,traffic_stats_mode,traffic_adjustment,traffic_source,traffic_used_scope` | CFSM流量额度展示 / Komari流量额度展示 | 11/11；本实例源为xray、scope为configured_period。有限额时可计算`limit-used`及比例，超额单列；0限额为不限量。用量等于模式处理后的原始U/D加调整量，不能再把调整量重复相加。两生态主题若用网卡总量计算占比，需额外核对，不能只映射limit |
| 周期原始上下行、每日趋势、已返回范围的汇总 | `traffic_used_up/down/total,period_start/end,daily_traffic`及范围字段 | 两生态的周期展示候选；扩展数据 | 11/11，可显示源端周期及逐日值，也可汇总已返回日记录。公开接口没有账本`complete`标志；缺日不能补0，更不能直接称完整自然月累计。CFSM/Komari未必有同口径标准字段 |
| 重置倒计时、到期展示、待续费数量 | `period_end,expires_at,renewal_cycle` | `expire_date,billing_cycle` / `expired_at,billing_cycle` | 11/11；可按日历差计算。`expires_at`文档允许回退到流量重置日，应称“源展示到期日”，不可当作独立核实的合同到期；周期枚举需转换，不能假定一个月恒为30天 |
| 价格、月/年成本折算、续费金额 | `renewal_price,renewal_currency,renewal_price_cny,renewal_cycle` | `price,currency,billing_cycle` / 同类节点字段 | 20:44复核7/11已有有效价格、币种、CNY折算价和周期，可按周期折算、按币种分别汇总或用源CNY值；另外4台仍缺值，不能把7台部分和当11台全站成本。缺失不是免费，永久周期不强行年化。20:34基线为0/11 |
| 服务商、回程与更多原生展示 | `provider_name/url,return_routes`；固定类型另有`unlocks,forward` | 通常是主题扩展，非两个协议共同核心 | 服务商2/11；回程字段11/11。20:44复核解锁信息7/11非空、共28条，已取得真实源证据；转发仍仅有固定消费者证据、本次未返回。不是两个协议共同核心必需字段 |

所有求和/平均须明确参与节点、缺值和时间范围；缺少某个节点时，不能把部分和标成完整全站值。每日流量、续费金额和告警阈值属于展示衍生数据，不因此新增告警系统。

## 2. 妙妙屋X公开API缺少基础数据或精确信息

这里的“缺少”指本次已扫描的公开契约与实际响应未提供，不能据此推断私有后端从未采集，也不推广到未来版本。历史缺失与当前值缺失分别列出。

| 缺口 | CFSM / Komari对应字段或需求 | 为什么已有字段不能推导；需要补充什么 |
| --- | --- | --- |
| 稳定公开节点ID、按ID历史查询 | CFSM `id`；Komari `uuid/entity_id` | 目前只有公开列表位置；同名、隐藏名称、重排、改名时不唯一。桥接自行分配ID只能建立有约束的绑定。需上游提供不可变不透明ID及按ID查询接口，不要求公开数据库ID或IP |
| Swap总量、已用量与历史 | `swap_total/swap_used` / `swap_total/swap` | 不能由内存容量/已用量反推出Swap；需要独立采集字段及序列 |
| GPU设备与指标 | CFSM `gpu_info`中的利用率、显存、频率、功耗；Komari `gpu_name/gpu/gpu_detailed_info`及设备历史 | CPU、内存无法推导GPU；需要设备索引/名称、利用率、显存、温度等真实字段，不能用空列表宣称“无GPU” |
| 磁盘IO | CFSM `disk.read_bps/write_bps/read_iops/write_iops/await_ms/util`及历史 | 磁盘容量变化无法还原读写吞吐、IOPS、等待与繁忙率。当前核对的Komari标准核心指标定义未列同等磁盘IO，不将它宣称为双方共同需求 |
| 进程数 | CFSM `processes` / Komari `process` | TCP/UDP不是进程数；`loadavg`也不能恢复进程数量，`/proc/loadavg`任务计数包含线程，不能直接替代 |
| 虚拟化类型 | Komari `virtualization` | OS、CPU型号、架构不能可靠判定KVM/LXC等，需上游明确提供 |
| 历史系统负载 | CFSM历史`load_avg` / Komari历史`load` | 当前快照有loadavg，但本次1h/7d系统历史均没有负载；CPU占用历史不是负载历史。现在开始记录也不能恢复过去数据 |
| 原始探测样本、逐包统计 | Komari Ping `total/valid/min/max/avg/p50/p99/stddev/p99_p50_ratio`等的精确口径 | 只有平均RTT和丢包百分比桶，没有样本数、成功/失败计数、原始RTT或充分分布信息。相同桶均值可能来自完全不同分布；桶统计无法无损恢复原统计。需逐样本值或相应聚合统计/直方图；p99不能用“桶均值的p99”冒充 |
| 精确探测方法与采集节奏 | CFSM `ping_mode,collect_interval,report_interval`；Komari任务`type,interval` | 源仅公开key/label/isp；固定原生类型明确不公开host/port/type。5分钟桶宽不是每次Ping间隔，WS文档的5秒也不是Agent采集间隔。若确有展示需求，只补非敏感方法/间隔元数据，不要求暴露目标地址 |
| Agent精确采样时刻与重启/计数器纪元 | CFSM `last_updated,boot_time`；Komari status `time`及累计差分 | 在线快照没有已确认的sampled_at；离线last_seen和历史桶时间不能替代它。uptime只能估算启动时刻。要消除跨重启/网卡重置的差分歧义，需采样时间和boot_id/counter_epoch等标识 |
| 完整自然月、跨重启累计和精确流量增量 | CFSM `net_rx_monthly/net_tx_monthly`；Komari `traffic_up/traffic_down`及指定窗口统计 | 本实例周期账本为Xray，开机累计为系统网卡；来源、周期不同。累计历史桶的取值方式/边界样本未有足够证据，不能直接用桶差或网速积分冒充精确增量。需同源完整日/月账本或边界计数器、重置语义与完整性标志 |
| 采集前、缺口内、更长或更细的历史 | 两生态记录、范围查询、历史图表 | 本次system/Ping历史最长源声明7天且未采满，最细已核实历史桶5分钟（daily_traffic是另一份周期日账本，实际可以包含更早日期）；无法恢复缺失时段或秒级峰值。查询参数、插值、按当前值回填都不能补足历史事实。更长保留期必须由源提供或另行明确建设采集存储 |
| 源节点分组、标签、公开备注、自动续费、创建/配置更新时间 | CFSM `server_group,tags,auto_renewal,timestamp`；Komari `group,tags,public_remark,auto_renewal,created_at/updated_at` | 名称、地区和续费周期不能还原原分组或自动续费开关，观察时间不是注册时间。可以另设桥接本地配置，但应标明本地来源，不伪装为源数据。公开列表顺序可保留，不代表取得源排序权重 |
| IPv4/IPv6能力与Agent版本 | CFSM `ip_v4/ip_v6,agent_version` | 妙妙屋未提供；不能从地区或在线状态推断双栈能力。CFSM公开IP字段实际是可达性标志，可只补布尔值，无需公开真实IP；Komari的public节点实现本身清空IP/Agent版本，不应误列为它的公开必需项 |

温度另需谨慎：妙妙屋当前没有温度基础字段；Komari GPU温度是真实定义的指标，已列入GPU缺口，但所核对的common最新状态将普通`temp`直接写为0，内置指标定义也没有独立通用温度项。不能把这个占位0当成Komari已实现真实CPU温度采集的证据。

完整周期用量、真实合同到期日、精确物理核心拓扑等存在**已有字段但语义/完整性不足**的情况，表中分别注明；不应简单写成“完全没有流量”“完全没有到期时间”“没有核心数”。

## 审计基线与当前实现的关系（下列1、2已在本次更新）

1. 本次中立模型已接入价格、周期流量、开机累计、核心数候选等；两个协议通过`bridge.data`保留基础字段并输出可靠衍生值。标准协议未映射不属于源缺失。
2. 系统历史归一化已保留源`cumulative_up/down`，两个协议通过`bridge.sourceCounters`输出；桶聚合与重置边界仍未核实，不能直接差分成精确流量增量。
3. 在线文档历史列表遗漏了实际存在的磁盘和TCP/UDP字段；范围仅列1h/6h/24h，而真实源声明7d并成功返回。文档把`cumulative_*`称“当前周期”，实际scope为`current_boot`；流量口径专页也明确这是开机累计。应以显式scope解释，保留文档差异记录。
4. 20:34时价格文档支持但11台均缺值；用户补充主控信息后，20:44复核已有7台返回有效价格及币种。这是实例缺值恢复的实际证据；剩余4台缺省原因仍不能仅凭只读公开响应确定，不把缺省解释为免费。
5. `last_seen`本次未返回是全在线时的正常行为；CPU型号3台缺省是单节点数据缺值，不是整个接口没有型号能力。

中立模型及可靠衍生已完成；按用户要求，不继续扩展主题适配。剩余源数据需求可优先考虑稳定公开ID、精确时间/计数器元数据、历史load和原始Ping统计需求。Swap/GPU/IO/进程等需要源采集能力。后台管理、Token、SSH地址、真实IP、隐藏名称等不属于要求公开补齐的数据。

## 可定位来源

- [CFSM固定API字段表](../references/upstream/cfsm-API.md)，[公开响应实现](../references/upstream/cfsm-source/src/handlers/dashboard.js)，[固定前台消费契约](frontend-contract.md)。
- [Komari固定节点/历史模型](https://github.com/komari-monitor/komari/blob/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f/database/models/models.go)、[common最新状态](https://github.com/komari-monitor/komari/blob/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f/web/rpc/jsonrpc/common.go)、[公开接口过滤](https://github.com/komari-monitor/komari/blob/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f/web/rpc/jsonrpc/public.go)。
- [Komari指标定义](https://github.com/komari-monitor/komari/blob/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f/internal/metricstore/definitions.go)、[Ping统计结构](https://github.com/komari-monitor/komari/blob/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f/web/rpc/jsonrpc/public.metric.go)；本地既有参考位于`work/protocol-audit/`，本轮未重新下载全部源码。
- [妙妙屋固定原生前台类型](../references/upstream/mmwx-probe-source/src/types.ts)、[参考清单](../references/mmwx-probe-manifest.json)、[之前的真实输入契约](upstream-contract.md)。
- [当前中立模型](../../src/core/model.ts)、[历史映射](../../src/upstream/series.ts)、[CFSM映射](../../src/protocols/cfsm/adapter.ts)、[Komari映射](../../src/protocols/komari/adapter.ts)。

最初扫描阶段仅新增报告；随后本次已实现中立数据准备，完成267项测试、Node构建、构建产物3项运行时检查与真实响应回放。未部署、未重启用户实例、未重新验收主题浏览器或WS；不扩大主题兼容声明。
