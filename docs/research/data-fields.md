# 数据字段与转换边界

LeoBridge分别输出原生、CFSM和Komari协议。源端有字段、桥接器有输出、主题能展示是三个不同条件；缺值不能解释成零或接口不支持。

## 基础指标

CPU使用率为百分比；中立模型的内存和磁盘容量为bytes，CFSM容量输出为MiB。网络速率为B/s，运行时长为秒。系统历史按真实时间合并，不按数组下标拼接，也不补零。

逻辑线程使用`cpu_threads`；`cpu_cores`仅作为来源候选保存。在线状态、缺值、过期和上游故障分别表达。详细输入结构见[上游契约](upstream-contract.md)，输出要求见[CFSM](frontend-contract.md)和[Komari](komari-protocol.md)。

## 扩展数据

[中立数据准备](../../src/core/prepared-data.ts)统一计算以下字段。CFSM节点和Komari节点、最新状态、近期报告通过`bridge.data`提供这些数据；系统历史通过`bridge.sourceCounters`保留累计计数器源桶。

| 数据组 | 已准备的数据与计算 | 口径 |
| --- | --- | --- |
| resources | 内存/磁盘剩余及占比、总网速、TCP+UDP、每逻辑CPU负载 | bytes、B/s、百分比；剩余不是Linux MemAvailable；缺项不当0 |
| billing | 原币价格/币种、CNY价、续费周期月数、月/年成本、源展示到期日与倒计时 | 按日历月折算，不把一个月转成30天；倒计时按UTC日历日期，源到期日不冒充合同时间戳 |
| traffic | 源、scope、方向、调整量、用量、限额、余额、超额、占比、周期日期 | 保留Xray与system区别；有reported用量时不重复加调整量；仅已知源/范围/模式及显式调整量时从U/D推导用量 |
| traffic.boot / cumulative | 两套源累计字段及current_boot范围、上下行合计 | 不映射成跨重启/月流量，不混合两组不同来源计数器 |
| traffic.daily | 日期、上下行、总量与已返回日期汇总 | 缺日不补0；缺方向不补0；重复/非法日期使账本不可用；不声称完整月账本 |
| ping | 全部唯一key目标的当前值/桶、桶级min/max/mean与有效桶数 | 不受CFSM八槽限制；保留缺值，不生成逐包统计/分位数；重复key不映射 |
| sourceMetadata / returnRoutes / unlocks | 核心数候选、地区/城市、服务商与安全HTTP(S)链接、回程、解锁 | 白名单输出；不把cpu_cores候选冒充已核实物理核心 |
| 历史 bridge.sourceCounters | cumulative_up/down源桶值 | 中立历史保留11项；两个协议保留源累计桶，不差分成精确流量，resetScope仍未知 |


Komari扁平近期报告包含load1/load5/load15。CFSM的价格、到期、流量显示开关仍关闭；Komari标准价格、计费周期、到期及流量额度字段仍为空，最新状态的标准`ping`摘要为空。扩展数据不会自动变成原主题的显示能力。

CFSM和Komari标准Ping历史共享最多8个显式目标绑定；原生协议与`bridge.data.ping`保留完整源目标。原生协议还保留公开费用、流量、回程、解锁及外观字段，详见[原生协议](native-theme.md)。

## 源端缺口与语义限制

以下结论依据2026-11-03核对的公开契约及真实响应，不推断私有后端或后续上游版本的采集能力。

| 缺口 | CFSM / Komari对应字段或需求 | 为什么已有字段不能推导；需要补充什么 |
| --- | --- | --- |
| 稳定公开节点ID、按ID历史查询 | CFSM `id`；Komari `uuid/entity_id` | 目前只有公开列表位置；同名、隐藏名称、重排、改名时不唯一。桥接自行分配ID只能建立有约束的绑定。需上游提供不可变不透明ID及按ID查询接口，不要求公开数据库ID或IP |
| Swap总量、已用量与历史 | `swap_total/swap_used` / `swap_total/swap` | 不能由内存容量/已用量反推出Swap；需要独立采集字段及序列 |
| GPU设备与指标 | CFSM `gpu_info`中的利用率、显存、频率、功耗；Komari `gpu_name/gpu/gpu_detailed_info`及设备历史 | CPU、内存无法推导GPU；需要设备索引/名称、利用率、显存、温度等真实字段，不能用空列表宣称“无GPU” |
| 磁盘IO | CFSM `disk.read_bps/write_bps/read_iops/write_iops/await_ms/util`及历史 | 磁盘容量变化无法还原读写吞吐、IOPS、等待与繁忙率。当前核对的Komari标准核心指标定义未列同等磁盘IO，不将它宣称为双方共同需求 |
| 进程数 | CFSM `processes` / Komari `process` | TCP/UDP不是进程数；`loadavg`也不能恢复进程数量，`/proc/loadavg`任务计数包含线程，不能直接替代 |
| 虚拟化类型 | Komari `virtualization` | OS、CPU型号、架构不能可靠判定KVM/LXC等，需上游明确提供 |
| 历史系统负载 | CFSM历史`load_avg` / Komari历史`load` | 当前快照有loadavg，但已核对的1h/7d系统历史均没有负载；CPU占用历史不是负载历史。现在开始记录也不能恢复过去数据 |
| 原始探测样本、逐包统计 | Komari Ping `total/valid/min/max/avg/p50/p99/stddev/p99_p50_ratio`等的精确口径 | 只有平均RTT和丢包百分比桶，没有样本数、成功/失败计数、原始RTT或充分分布信息。相同桶均值可能来自完全不同分布；桶统计无法无损恢复原统计。需逐样本值或相应聚合统计/直方图；p99不能用“桶均值的p99”冒充 |
| 精确探测方法与采集节奏 | CFSM `ping_mode,collect_interval,report_interval`；Komari任务`type,interval` | 源仅公开key/label/isp；固定原生类型明确不公开host/port/type。5分钟桶宽不是每次Ping间隔，WS文档的5秒也不是Agent采集间隔。若确有展示需求，只补非敏感方法/间隔元数据，不要求暴露目标地址 |
| Agent精确采样时刻与重启/计数器纪元 | CFSM `last_updated,boot_time`；Komari status `time`及累计差分 | 在线快照没有已确认的sampled_at；离线last_seen和历史桶时间不能替代它。uptime只能估算启动时刻。要消除跨重启/网卡重置的差分歧义，需采样时间和boot_id/counter_epoch等标识 |
| 完整自然月、跨重启累计和精确流量增量 | CFSM `net_rx_monthly/net_tx_monthly`；Komari `traffic_up/traffic_down`及指定窗口统计 | 本实例周期账本为Xray，开机累计为系统网卡；来源、周期不同。累计历史桶的取值方式/边界样本未有足够证据，不能直接用桶差或网速积分冒充精确增量。需同源完整日/月账本或边界计数器、重置语义与完整性标志 |
| 采集前、缺口内、更长或更细的历史 | 两生态记录、范围查询、历史图表 | 已核对的system/Ping历史最长源声明7天且未采满，最细已核实历史桶5分钟（daily_traffic是另一份周期日账本，实际可以包含更早日期）；无法恢复缺失时段或秒级峰值。查询参数、插值、按当前值回填都不能补足历史事实。更长保留期必须由源提供或另行明确建设采集存储 |
| 源节点分组、标签、公开备注、自动续费、创建/配置更新时间 | CFSM `server_group,tags,auto_renewal,timestamp`；Komari `group,tags,public_remark,auto_renewal,created_at/updated_at` | 名称、地区和续费周期不能还原原分组或自动续费开关，观察时间不是注册时间。可以另设桥接本地配置，但应标明本地来源，不伪装为源数据。公开列表顺序可保留，不代表取得源排序权重 |
| IPv4/IPv6能力与Agent版本 | CFSM `ip_v4/ip_v6,agent_version` | 妙妙屋未提供；不能从地区或在线状态推断双栈能力。CFSM公开IP字段实际是可达性标志，可只补布尔值，无需公开真实IP；Komari的public节点实现本身清空IP/Agent版本，不应误列为它的公开必需项 |


周期用量的完整性、到期日的合同含义和物理核心拓扑仍需按源定义确认。`current_boot`累计不等于月流量；历史日账本的日期跨度不代表系统或Ping历史具有相同保留期。部分节点缺价格、型号或服务商，不代表整个接口缺少这些字段。

## 依据

- [输入契约](upstream-contract.md)及[参考版本清单](../references/README.md)：记录文档与真实响应差异。
- [CFSM API](../references/upstream/cfsm-API.md)及[公开响应实现](../references/upstream/cfsm-source/src/handlers/dashboard.js)。
- Komari核心固定于`96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f`，方法和指标依据见[Komari协议](komari-protocol.md)。
- [原生前台类型](../references/upstream/mmwx-probe-source/src/types.ts)及[独立参考清单](../references/mmwx-probe-manifest.json)。
- 实现：[中立模型](../../src/core/model.ts)、[系统历史](../../src/upstream/series.ts)、[CFSM转换](../../src/protocols/cfsm/adapter.ts)、[Komari转换](../../src/protocols/komari/adapter.ts)。
