# Komari 官方默认前台

本文保留官方默认前台和Adhesive Note两套历史适配包的消费者审计，供维护Komari协议使用。2026-11-03起，两套应用源码及专用构建脚本均已移除；当前主题按需从商店安装，不能把下述补丁行为当作原版行为。

官方前台固定为 [komari-monitor/komari-web@bed58b589da63232a17681b1dbaed9eab2423078](https://github.com/komari-monitor/komari-web/tree/bed58b589da63232a17681b1dbaed9eab2423078)。该版本无独立LICENSE，标为NOASSERTION，不套用核心MIT；原README、摘要和补丁见[来源档案](../references/retired-themes/README.md)。

## 官方前台消费者契约

官方首页使用 `common:getNodes`（uuid 键控节点对象）、`common:getNodesLatestStatus`；详情使用 `/api/recent/:uuid`、`public:listMetricDefinitions`、`public:queryMetrics`、`public:getPublicPingTasks` 和 `public:getPingMetricStats`。公共设置仍从 `/api/public` 获取，版本使用 `common:getVersion`。主通道是 `/api/rpc2` HTTP/WebSocket；每五秒查询实时状态，隐藏或卸载页面关闭连接。

`public:queryMetrics` 接收 `entity_id`、`metric_keys`、`hours`，返回带 `metric_key/entity_id/unit/interval_seconds/points` 的序列；CPU 百分比、内存/磁盘 bytes、网速 B/s，Ping ms、丢包率百分比。保留源桶真实时间、零值和 null；图表只插入空断点，不生成数值样本，不使用 EWMA、插值或当前容量回填历史。新请求清除旧范围图，错误明确显示。

支持相对历史范围，拒绝任意起止日期及非源桶聚合请求。源端不提供逐包计数与分位数，所以 `public:getPingMetricStats` 返回空统计及明确限制，丢包率由独立源桶曲线呈现。管理、终端、安装恢复页面、临时密钥 cookie 入口与 PWA 注册未纳入公共应用。

固定安装 profile 为 `komari-default-bed58b5`，适配包为 `LeoBridgeKomariDefault / bed58b5-leobridge.1`。验收见[官方前台验收](komari-default-acceptance.md)。这些标识仅用于识别历史适配安装；当前构建不会生成或自动导入该包。

## 旧便签纸适配记录

以下为Adhesive Note适配包的来源与契约，不代表商店原包已完整兼容。


2026-11-02。选用官方Komari商店目录中的 **Adhesive Note v1.0.0**，仓库 [stqfdyr/komari-theme-adhesive-note](https://github.com/stqfdyr/komari-theme-adhesive-note/tree/8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914)，固定提交 `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`。不是自造占位界面。

Adhesive Note代码采用MIT，字体与图形适用各自条款，见[第三方素材说明](../references/retired-themes/komari/THIRD_PARTY.md)。

## 原始包与本地适配分开

官方商店原包short=`AdhesiveNote`、version=`1.0.0`，目录SHA-256为`94f69c657413e7b3204cfea0bce94f1ee5deb1f897364664b27367b592d49c80`。该摘要**不代表本地修改后构建**。

历史适配构建使用manifest short=`LeoBridgeAdhesiveNote`、version=`1.0.0-leobridge.1`，保留原作者及来源。原文件摘要与[补丁记录](../references/retired-themes/komari/PATCHES.md)仍在档案目录；原源码和构建命令不再是当前仓库入口。

## 实际调用

全部请求来自真实主题 `src/api/queries.ts` 和 `src/lib/rpc2.ts`，主通道是 **JSON-RPC 2.0**；不是旧式 `/api/clients` 文本get协议。

| method | params | result消费形状 |
| --- | --- | --- |
| `public:getNodesInformation` | `{}` | 静态节点数组，uuid/name/cpu_name/cpu_cores/os/kernel_version/arch/region/mem_total/disk_total等 |
| `public:getPublicSettings` | `{}` | sitename、record_enabled、record_preserve_time、ping_record_preserve_time；桥接扩展bridge.history_hours/stale_ms |
| `common:getNodesLatestStatus` | `{}` | uuid键控的扁平状态对象，time ISO、cpu%、ram/disk字节、net_in/out B/s、uptime秒、online显式状态等 |
| `public:getClientRecentRecords` | `{uuid}` | 实际近实时观察样本数组，updated_at ISO与cpu.usage、ram.used/total、network.up/down等嵌套结构 |
| `public:getRecordsByUUID` | `{uuid,load_type:'all',hours:'N'}` | `{count,records:[{client,time,cpu,ram,ram_total,disk,disk_total,net_in,net_out,…}]}` |
| `public:getPingRecords` | `{uuid,hours:'N'}` | `{count,records:[{task_id,time,value,client}],tasks:[{id,name,type,interval,…}]}`；桥接额外每点loss_percent/aggregation |
| `rpc.ping` | `{}`、不带id | 心跳notification，不创建请求结果 |

HTTP是 `POST /api/rpc2`；WS是同路径GET升级，发送 `{jsonrpc:'2.0',id,method,params}` 并按id接收result/error。实时5秒发RPC请求；没有CFSM subscribe/batchUpdate消息。原版已提供HTTP回退、心跳和重连，适配补齐过期状态与旧连接清理。

系统字节容量按1024格式化；网速输入B/s，在UI乘8按1000显示bps/Kbps/Mbps；不能预先在服务端转bits。历史CPU真0保留。时间进入uPlot前由ISO转Unix秒，最近缓存不以浏览器每次收包时间重复制造新点。

原版针对Komari1.4.3实测曾用静态mem_total代替历史ram_total=0；LeoBridge适配明确使用每点真实total，无total则为空，不把当前容量注入过去。负Ping画缺口；丢包图读取源桶loss_percent，不把负延迟变成整桶100%或把正延迟当0%丢包。

## 路由与资源

首页 `/`，详情 `/instance/:uuid`。按不可变安装hostname隔离方案，保留主题原有绝对`/api`和`/assets`，避免正则重写压缩JS。内置素材包括纸张WebP、图钉PNG、两款自托管WOFF2和Twemoji国旗，无运行时字体CDN依赖。未知详情/资源路径必须由运行层区别处理，不能把HTML伪装成缺失JS。

管理入口替换为只读说明；不包含Komari管理后台、采集、终端或远程控制。身份、可公开范围和Token仍由服务端统一层约束；主题不接触主控秘密。
