// Read-only catalog of the implemented data contracts. No source requests or credentials.
// Keep aligned with protocols/*/service.ts, core/prepared-data.ts and research contracts.
const snapshotSource='/api/public/probe-servers';
const historySource='/api/public/probe-series';
const liveSource='/api/public/probe-ws';
const rangeNote='历史保留缺口，不补零、不插值。7 天须由主控声明支持；范围上限不代表已采满。历史查询前后核对节点身份，变化时拒绝结果。';
const sourceEvidence='依据：主控探针文档、固定原生前台及已有接口审计。主控具体版本未知；历史记录不代表当前实例可用。';
const bridgeEvidence='依据：当前桥接实现及协议契约。实现接入不等于每个主题都会展示，也不等于主题完整兼容。';
const sourceFields=[
  ['servers[].cpu_pct','CPU 使用率','主控提供','%'],
  ['servers[].mem_used / mem_total / disk_used / disk_total','内存、磁盘已用与容量','主控提供','bytes'],
  ['servers[].upload_speed / download_speed','上行、下行速率','主控提供','B/s'],
  ['servers[].online / last_seen / uptime','在线状态、离线最后心跳、运行时长','主控提供','布尔 / Unix 秒 / 秒'],
  ['servers[].ping','目标 key、当前延迟、丢包与短时桶','主控提供','ms / %'],
  ['servers[].traffic_* / boot_traffic_* / cumulative_* / daily_traffic','周期用量、开机累计、日账本；连同 source / scope 解释','主控提供','bytes / 日期'],
  ['servers[].renewal_* / expires_at','价格、币种、续费周期与源展示到期日','主控提供','原币 / CNY / 日期'],
  ['servers[].provider_* / return_routes / unlocks','服务商、回程与解锁资料','主控提供','文本 / 记录'],
  ['history_days / appearance / license_badge','历史能力、外观及许可标记','主控提供','天 / 对象'],
];
const historyFields=[
  ['bucket_sec / generated_at','桶宽及生成时间','主控提供','秒 / Unix 秒'],
  ['buckets（system）','预期桶容量，不是实际采样数量','主控提供','整数'],
  ['series（system）','CPU、内存、磁盘、网速、连接数及累计网卡流量的独立序列 {t,value}','主控提供','t 为 Unix 秒；值沿用指标单位'],
  ['series / all_series（ping）','各目标 key、延迟与丢包桶；桶没有独立时间戳','主控提供','ms / %；-1 表示无数据'],
];
const forwardFields=[['chains / forward','转发链、分组、路由、延迟、丢包及趋势','主控提供','按字段：ms / % / GB']];
const preparedFields=[
  ['bridge.data.resources','剩余容量、占用比例、总网速、连接合计、每逻辑 CPU 负载','桥接计算','bytes / % / B/s / 个'],
  ['bridge.data.billing（monthlyCost / annualCost / daysUntilSourceExpiry）','保留源价格；按日历月折算月/年成本，按 UTC 日期计算到期天数','主控提供 + 桥接计算','原币 / CNY / 月 / 天'],
  ['bridge.data.traffic','保留 source / scope / mode；同口径计算余额、超额、占比及已返回日期汇总','主控提供 + 桥接计算','bytes / % / 日期'],
  ['bridge.data.ping','全部唯一 key 目标及有效桶的 min / max / mean，不受标准八槽输出限制','主控提供 + 桥接计算','ms / % / 桶数'],
  ['bridge.data.sourceMetadata / returnRoutes / unlocks','白名单保留公开资料；服务商链接仅接受安全 HTTP(S) 地址','桥接转换','文本 / 记录'],
];
const cfsmFields=[
  ['id / name / online','显式绑定的稳定 ID、遵循名称隐藏的名称及在线状态','桥接转换','字符串 / 布尔或未知'],
  ['cpu / ram_used / ram_total / disk_used / disk_total','CPU 保留百分比，内存和磁盘从 bytes 换算','桥接转换','% / MiB'],
  ['net_in_speed / net_out_speed / tcp_conn / udp_conn','网络速率及连接数','桥接转换','B/s / 个'],
  ['ping_* / loss_*','按配置的目标 key 映射到最多 8 个槽位','桥接转换','ms / %'],
  ...preparedFields,
];
const komariMeta=[['bridge.stale / bridge.transport','数据过期标识与实际数据运输方式','桥接计算','布尔 / websocket 或 poll'],...preparedFields];
const komariFields=[
  ['uuid / name / cpu_name / cpu_cores / os','桥接身份与公开系统资料；cpu_cores 使用逻辑线程数','桥接转换','字符串 / 个'],
  ['mem_total / disk_total','内存及磁盘容量','桥接转换','bytes'],
  ...komariMeta,
];
const komariStatusFields=[
  ['client / time / online','桥接稳定身份、观察时间及在线状态','桥接转换','字符串 / ISO 日期 / 布尔或未知'],
  ['cpu / ram / ram_total / disk / disk_total','CPU 使用率、内存与磁盘已用及容量','桥接转换','% / bytes'],
  ['net_in / net_out / connections_tcp / connections_udp / connections','下载、上传速率及连接数；合计由 TCP + UDP 计算','桥接转换 + 桥接计算','B/s / 个'],
  ['load / load5 / load15 / uptime','当前负载与运行时长','桥接转换','负载 / 秒'],
  ...komariMeta,
];
const komariRecentFields=[
  ['uuid / updated_at','桥接稳定身份与观察时间','桥接转换','字符串 / ISO 日期'],
  ['cpu.usage / ram / disk / network / connections / load / uptime','嵌套资源、网速、连接、负载与运行时长','桥接转换','% / bytes / B/s / 个 / 秒'],
  ...komariMeta,
];
const bridgeHistory=[
  ['系统历史指标','按真实时间合并稀疏指标；CFSM 容量 MiB，Komari 容量 bytes','桥接转换','% / 容量 / B/s / 个'],
  ['Ping / loss','从源桶与 generated_at 推算桶时间，仅输出已配置目标','桥接转换','ms / %'],
  ['bridge.sourceCounters','保留 cumulative_up/down 源累计桶，不差分成精确区间流量','桥接转换','bytes'],
];
const configFields=[['站点配置 / 展示能力','桥接配置、当前安装上下文与源历史能力共同决定','桥接生成','配置对象']];
const entries=[];
function add(protocol,title,path,description,options={}){
  entries.push({protocol,title,path,description,origin:'bridge',fields:[],params:'无。',sources:[],processing:'按既有契约读取。',status:'已接入',limits:'缺失值不视为真实零；实际返回取决于主控公开范围与采集配置。',evidence:bridgeEvidence,...options});
}
function addSource(title,path,description,options){add('native',title,path,description,{origin:'source',evidence:sourceEvidence,...options});}
addSource('节点状态与公开资料',`GET ${snapshotSource}`,'资源、网络、流量、价格、到期、回程和解锁等公开数据。',{
  fields:sourceFields,processing:'主控原始输入；桥接器按不同协议分别选择和转换。',status:'部分接入',
  limits:'原生协议白名单保留公开字段；CFSM / Komari 标准价格与流量字段尚未完整映射，部分数据仅位于 bridge.data。源列表无已确认的不可变节点 ID。',
  evidence:sourceEvidence+' 2026-11-03 已有真实快照及字段回放记录。',
});
addSource('系统与 Ping 历史',`GET ${historySource}`,'独立指标历史与各目标延迟、丢包桶。',{
  params:'server=当前公开数组下标；metric=system|ping；range=1h|6h|24h|7d；Ping 用 all=1。',fields:historyFields,
  processing:'作为三个协议的历史来源；server 下标不能作为稳定身份。',limits:rangeNote+' 2d–6d 曾见前台支持，未逐档真实核验。',
  evidence:sourceEvidence+' 1h / 6h / 24h / 7d 有历史实测记录。',
});
addSource('实时节点快照',`WS ${liveSource}`,'与节点快照同结构的实时消息。',{
  fields:sourceFields,processing:'服务端建立上游连接，再按展示协议输出。',limits:'握手成功不等于持续收到数据；不承诺固定 5 秒节奏。',
  evidence:sourceEvidence+' 已有真实连续帧记录；长期稳定性未完整验收。',
});
addSource('转发链数据','GET /api/public/probe-forward','转发链、路由、趋势与链路相关统计。',{
  fields:forwardFields,processing:'原生协议接入；隐藏名称时不公开链名。',status:'部分接入',
  limits:'仅原生协议接入；CFSM / Komari 无对应输出。完整真实链路未验收。',evidence:sourceEvidence+' 已有固定前台与桥接实现依据；无完整真实链路验收结论。',
});
const nativeOptions={fields:sourceFields,sources:[snapshotSource],processing:'白名单筛选、名称隐私处理、显式身份绑定与展示槽位映射；可按安装版本覆盖 appearance.theme。',limits:'使用源单位；并非任意字段透传。外观覆盖不改变主控设置或许可标记。'};
add('native','原生主题节点数据','GET /api/probe','供原生主题展示的公开节点与站点数据。',nativeOptions);
add('native','原生主题历史','GET /api/series','保留源历史结构和单位，核对节点身份及桶宽。',{
  fields:historyFields,sources:[snapshotSource,historySource],params:'server=桥接展示槽位；metric=system|ping（默认 ping）；range=1h|6h|24h|2d|3d|4d|5d|6d|7d（默认 1h）。',
  processing:'把展示槽位解析到当前源下标；查询前后核对完整身份顺序，筛选允许的历史字段。',limits:rangeNote+' 2d–6d 路径已实现，未逐档真实验证。',
});
add('native','原生主题实时数据','WS /api/stream','向原生主题发送经过公开字段筛选的完整快照。',{
  ...nativeOptions,sources:[liveSource],params:'WebSocket 只读连接；不接受客户端数据消息。',limits:'断线退避重连，过期触发重连；HTTP 轮询由原生前台承担。切换主题或外观会关闭相应旧连接。',
});
add('native','原生主题转发链','GET /api/forward','经过公开范围筛选的链路数据。',{
  sources:[snapshotSource,'/api/public/probe-forward'],fields:forwardFields,processing:'查询前后检查名称公开设置与身份；链路字段按白名单输出。',limits:'名称隐藏时返回空链列表；真实链路完整验收尚未完成。',
});
add('cfsm','节点列表与汇总','GET /api/servers','节点指标、地区分布和在线节点网络速率汇总。',{
  sources:[snapshotSource],fields:[...cfsmFields,['stats / regionStats','在线 / 离线 / 未知计数、已知在线速率合计、地区计数','桥接计算','个 / B/s']],
  processing:'显式身份映射、单位转换、Ping 槽位映射及可靠衍生计算。',status:'部分接入',limits:'标准价格、到期、流量显示开关关闭；相关可用数据位于 bridge.data，主题不一定消费。GPU / Swap / 磁盘 IO 等未提供。',
});
add('cfsm','单节点详情','GET /api/server','单节点指标、预处理扩展及展示配置。',{
  sources:[snapshotSource],fields:cfsmFields,params:'id=桥接稳定 ID（必填）。',processing:'与节点列表使用同一转换；不按名称或数组下标查找节点。',status:'部分接入',limits:'字段范围与节点列表一致；缺价格或流量不代表免费或无限。',
});
add('cfsm','展示配置与历史能力','GET /api/config','站点标题、Ping 槽位名称及可用历史档位。',{
  sources:[snapshotSource,'桥接配置'],fields:configFields,processing:'生成 CFSM 展示配置；show_price / show_expire / show_tf 固定为 false。',limits:'不是主控配置接口，不提供管理写入。历史档位不代表实际采样完整。',
});
add('cfsm','资源与 Ping 历史','GET /api/history/all','按时间合并系统及已配置目标的 Ping 历史。',{
  sources:[snapshotSource,historySource],fields:[...bridgeHistory,['timestamp','源 Unix 秒转为毫秒','桥接转换','Unix 毫秒']],
  params:'id=桥接稳定 ID；hours=0.167|0.5|1|6|12|24|48|96|168（默认 1）。',processing:'从已支持源范围读取并裁剪，换算单位、按真实时间合并。',limits:rangeNote+' 48 / 96 / 168 小时需要源声明 7 天。',
});
add('cfsm','实时订阅','WS /api/ws','订阅节点，接收 CFSM 实时状态与更新消息。',{
  sources:[liveSource,snapshotSource],fields:cfsmFields,status:'部分接入',params:'连接后发送 type=subscribe、scope=all 或某个稳定 ID、ids=稳定 ID 数组。',
  processing:'上游帧转换为 CFSM 消息；连续无完整帧时尝试真实 HTTP 回退。',limits:'支持断线重连、过期标识与关闭清理；不以旧缓存冒充恢复。',
});
function rpc(title,method,description,options={}){add('komari',title,'POST /api/rpc2 · WS /api/rpc2',description,{rpc:method,params:'无业务参数（params={}）。',...options});}
const nodes={sources:[snapshotSource],fields:komariFields,processing:'显式身份映射、独立 Komari 序列化及 bridge.data 数据准备。',status:'部分接入',limits:'标准价格 / 到期 / 流量等字段保留未知；扩展已输出不代表主题已展示。'};
rpc('节点资料列表','public:getNodesInformation','返回节点硬件、系统、身份及预处理扩展。',nodes);
rpc('节点资料索引','common:getNodes','返回按稳定 ID 索引的节点，或指定节点资料。',{...nodes,params:'可选 uuid=桥接稳定 ID。'});
rpc('最新节点状态','common:getNodesLatestStatus','返回资源、在线状态与运输信息。',{
  ...nodes,fields:komariStatusFields,params:'可选 uuid，或 uuids 数组（最多 500 项）。',limits:'最新状态的标准 ping 摘要为空；使用独立 Ping 历史或 bridge.data.ping。',
});
const recent={...nodes,fields:komariRecentFields,params:'uuid=桥接稳定 ID（必填）。',processing:'只保留桥接进程实际观察到的在线样本，最多最近 10 分钟、60 条；按各方法序列化。',limits:'不是主控历史数据库；进程重启后不保留，不回填启动前数据。'};
rpc('近期节点报告','public:getClientRecentRecords','返回当前进程观察到的短时样本。',recent);
rpc('近期扁平状态','common:getNodeRecentStatus','以扁平记录返回近期资源状态。',{...recent,fields:komariStatusFields.filter(field=>!field[0].includes('client / time')).concat([['client / time','稳定身份与观察时间','桥接转换','字符串 / ISO 日期']]),params:'uuid 必填；limit 可选整数 1–10000，实际最多已有 60 条。'});
rpc('站点公开配置','public:getPublicSettings','标题、当前主题设置与保留范围。',{
  aliases:['common:getPublicInfo'],sources:[snapshotSource,'桥接配置 / 安装上下文'],fields:configFields,processing:'结合源历史能力生成 Komari 展示设置。',limits:'不是完整 Komari 后端；主题设置来自当前安装上下文。',
});
rpc('公开 Ping 目标','public:getPublicPingTasks','返回配置中的目标及适用节点。',{
  sources:['桥接 Ping 目标配置',snapshotSource],fields:[['id / name / clients / type','显式 key 转换为目标标识与节点列表；type 为 aggregate','桥接转换','标识 / 数组']],
  processing:'仅使用配置绑定的目标，当前共享配置最多 8 槽。',limits:'Komari 本身并非只支持 8 个目标；不提供新建探测任务。',
});
const records={sources:[snapshotSource,historySource],fields:[['records[].client / time / cpu / ram / disk / net_in / net_out / connections_tcp / connections_udp','系统指标与节点、时间；总容量字段为 ram_total / disk_total','桥接转换','ISO 日期 / % / bytes / B/s / 个'],bridgeHistory[2]],processing:'使用独立 Komari 历史转换，时间输出为 ISO 日期；保留真实源桶。',status:'部分接入',limits:rangeNote+' GPU、Swap、温度、进程及负载历史等缺少源数据，不伪造。'};
rpc('系统历史记录','public:getRecordsByUUID','读取指定节点的系统指标历史。',{
  ...records,params:'uuid 必填；hours > 0 且 ≤ 168（默认 4）；load_type 默认 all。接受的类别不保证有对应数据，见限制。',
});
rpc('Ping 历史记录','public:getPingRecords','读取节点或任务的延迟、丢包与桶摘要。',{
  ...records,fields:[['records[].task_id / client / time / value / loss_percent','目标与节点的延迟、丢包桶','桥接转换','标识 / ISO 日期 / ms / %'],['tasks','有效桶数量与 min / max / avg / loss 摘要','桥接计算','桶数 / ms / %']],params:'uuid 或 task_id；hours > 0 且 ≤ 168（默认 4）；可用 task_id 筛选。',limits:rangeNote+' 仅已配置目标；摘要基于聚合桶，不是逐包统计。',
});
rpc('分组历史查询','common:getRecords','按节点分组的系统记录，或扁平 Ping 记录。',{
  ...records,fields:[...records.fields,['records / tasks（type=ping）','扁平 Ping 记录及目标桶摘要','桥接转换 + 桥接计算','ISO 日期 / ms / % / 桶数']],params:'type=load|ping（默认 load）；uuid 可选；hours 默认 1；load_type / task_id 按类型使用。',limits:rangeNote+' 不支持任意起止日期；maxCount 不改变源桶，不作为实际点数保证。',
});
rpc('指标定义','public:listMetricDefinitions','列出可查询指标、单位及可用范围。',{
  sources:[snapshotSource,'桥接指标定义'],fields:[['指标定义','可用指标键、单位与历史能力','桥接生成','定义列表']],processing:'根据源能力声明构造指标目录。',limits:'目录中的保留范围不代表每个桶都有有效值。',
});
rpc('指标历史查询','public:queryMetrics','按指标键查询指定节点的聚合历史。',{
  ...records,fields:[['series[].metric_key / entity_id / unit / interval_seconds / points','系统或 Ping 指标序列；points 包含 ISO time 和 value','桥接转换','按 unit：% / bytes / bytes/s / count / ms / ratio'],['bridge.unsupported','请求中未实现的指标键','桥接生成','字符串数组']],params:'entity_id 必填；metric_keys 数组最多 32 项；hours 默认 4；aggregation 仅 avg。',limits:rangeNote+' 不支持任意起止日期或其他聚合；未实现指标键列入 bridge.unsupported，不伪造序列。ping.loss 为 0–1 比率，ping.loss_percent 为百分比。',
});
rpc('Ping 桶级统计','public:getPingMetricStats','返回有效桶的最小、最大、平均延迟与丢包摘要。',{
  sources:[snapshotSource,historySource],fields:[['min / max / avg / latest / loss / sample_buckets','基于源聚合桶的摘要，loss 标记 approximate','桥接计算','ms / % / 桶数']],
  params:'entity_id 必填；hours 默认 4；task_id / task_ids 可选；aggregation 仅 avg；不支持任意起止日期。',processing:'汇总有效源桶，不生成逐包统计或分位数。',limits:rangeNote+' total / valid 包数未知；无有效值的可选统计字段省略。',
});
rpc('桥接协议版本','public:getVersion','返回桥接服务声明的版本与协议标识。',{
  aliases:['common:getVersion','common:getBackendVersion'],fields:[['version / hash','桥接声明的版本及协议 profile','桥接生成','字符串']],processing:'由桥接器生成，不请求主控。',limits:'不是主控版本，也不是实时探测结果。',
});
for(const method of ['public:getMe','common:getMe'])rpc('访客身份声明',method,'声明当前主题协议使用访客身份。',{
  fields:[['logged_in / username','固定访客声明；common 方法另含空身份字段','桥接生成','false / Guest']],processing:'兼容主题访客流程，不代理主控或桥接管理登录。',limits:'不提供登录、身份管理或远程操作。',
});
rpc('RPC 心跳','rpc.ping','带 id 时返回 pong；无 id 的通知不回包。',{
  fields:[['result','固定 pong','桥接生成','字符串']],processing:'仅确认 RPC 处理链路，不访问主控。',limits:'收到 pong 不代表主控数据正常或新鲜。',
});
const rest=[
  ['/api/nodes','public:getNodesInformation'],['/api/public','public:getPublicSettings'],['/api/me','public:getMe'],['/api/version','public:getVersion'],
  ['/api/records/load','public:getRecordsByUUID'],['/api/records/ping','public:getPingRecords'],['/api/task/ping','public:getPublicPingTasks'],['/api/recent/:uuid','public:getClientRecentRecords'],
];
for(const [path,method]of rest){
  const original=entries.find(entry=>entry.rpc===method);
  add('komari',`${original.title} · REST`, `GET ${path}`,original.description,{
    ...Object.fromEntries(['sources','fields','status','limits','evidence'].map(key=>[key,original[key]])),
    params:path.includes(':uuid')?'uuid 放在路径中。':original.params==='无业务参数（params={}）。'?'无查询参数。':`查询参数与 ${method} 对应：${original.params}`,
    processing:`调用 ${method} 的同一实现；${path==='/api/me'?'直接返回访客对象。':'返回 {status, data} 包裹。'}`,
  });
}
add('komari','旧版实时报告','WS /api/clients','为旧主题提供嵌套 Report 快照。',{
  ...nodes,fields:komariRecentFields,sources:[liveSource,snapshotSource],params:'发送文本 get 或 get <稳定 UUID>。',processing:'响应当前节点报告；无完整上游帧时可读取真实 HTTP 快照。',limits:'属于旧版兼容入口，不是 JSON-RPC；未知指标保留未知。',
});
export const dataInterfaces=entries;
export const protocolLabels={native:'原生',cfsm:'CFSM',komari:'Komari'};
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
function definition(label,text){const row=node('div');row.append(node('dt',label),node('dd',text));return row;}
function card(entry){
  const details=node('details',undefined,'interface-card'),summary=node('summary'),heading=node('div',undefined,'interface-heading'),tags=node('div',undefined,'interface-tags');
  tags.append(node('span',entry.origin==='source'?'主控':'桥接器',`interface-tag ${entry.origin}`),node('span',protocolLabels[entry.protocol],'interface-tag'),node('span',entry.status,'interface-tag'));
  heading.append(node('h3',entry.title),tags);
  summary.append(heading,node('p',entry.description),node('code',entry.rpc||entry.path,'interface-path'),node('span','查看字段与调用说明','interface-expand'));
  details.append(summary);
  const body=node('div',undefined,'interface-body'),metadata=node('dl',undefined,'interface-metadata');
  metadata.append(definition('调用入口',entry.path),definition('调用参数',entry.params));
  if(entry.rpc)metadata.append(definition('请求格式',JSON.stringify({jsonrpc:'2.0',id:1,method:entry.rpc,params:{}})+'；params 按上方参数说明填写。'));
  if(entry.aliases)metadata.append(definition('兼容方法名',entry.aliases.join('、')));
  metadata.append(definition('数据来源',entry.sources.join(' + ')|| (entry.origin==='source'?'主控公开探针':'桥接器自身')),
    definition('处理规则',entry.processing),definition('适用限制',entry.limits),definition('验证依据',entry.evidence),definition('当前实例','未检查 · 此目录不自动请求接口。'));
  body.append(metadata,node('h4','主要返回字段'));
  const fields=node('div',undefined,'interface-fields');
  for(const [key,meaning,origin,unit]of entry.fields){
    const field=node('div',undefined,'interface-field');field.append(node('code',key),node('p',meaning),node('small',`${origin} · ${unit}`));fields.append(field);
  }
  body.append(fields);details.append(body);return details;
}
export function setupDataInterfaces(root){
  const search=root.querySelector('#interface-search'),origin=root.querySelector('#interface-origin'),protocol=root.querySelector('#interface-protocol'),list=root.querySelector('#interface-list'),count=root.querySelector('#interface-count');
  function render(){
    const query=search.value.trim().toLocaleLowerCase();
    const visible=entries.filter(entry=>(!origin.value||entry.origin===origin.value)&&(!protocol.value||entry.protocol===protocol.value)&&(!query||JSON.stringify(entry).toLocaleLowerCase().includes(query)||protocolLabels[entry.protocol].toLocaleLowerCase().includes(query)));
    list.replaceChildren();count.textContent=`显示 ${visible.length} / ${entries.length} 项 · RPC 兼容方法名合并展示 · 未执行在线检查`;
    for(const key of Object.keys(protocolLabels)){
      const selected=visible.filter(entry=>entry.protocol===key);if(!selected.length)continue;
      const section=node('section',undefined,'interface-group');section.append(node('h2',`${protocolLabels[key]} · ${selected.length}`));selected.forEach(entry=>section.append(card(entry)));list.append(section);
    }
    if(!visible.length)list.append(node('p','没有匹配的接口。可尝试字段名、数据用途或清除筛选。','empty'));
  }
  search.addEventListener('input',render);origin.addEventListener('change',render);protocol.addEventListener('change',render);
  root.querySelector('#interface-reset').addEventListener('click',()=>{search.value='';origin.value='';protocol.value='';render();search.focus();});
  render();
}
