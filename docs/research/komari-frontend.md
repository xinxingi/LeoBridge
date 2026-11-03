# Komari 官方默认前台

当前内置前台来自 [komari-monitor/komari-web](https://github.com/komari-monitor/komari-web/tree/bed58b589da63232a17681b1dbaed9eab2423078)，固定提交 `bed58b589da63232a17681b1dbaed9eab2423078`（radix）。保留官方首页卡片/表格、详情和 Radix/Recharts 图表，应用副本为 `web/themes/komari-default/`，构建入口 `scripts/build-komari-default.mjs`。它替代内置便签纸包；旧便签纸源码与协议保留以支持已有安装。

此版本没有独立 LICENSE，README 明确给出二次开发和主题打包步骤。本项目按所有者指定完成本地接入，标记 `NOASSERTION`，保留原始 README、来源摘要和补丁，未宣称其采用 MIT；再分发范围仍需向上游明确，见[第三方声明](../../THIRD_PARTY_NOTICES.md)。

## 当前消费者契约

官方首页使用 `common:getNodes`（uuid 键控节点对象）、`common:getNodesLatestStatus`；详情使用 `/api/recent/:uuid`、`public:listMetricDefinitions`、`public:queryMetrics`、`public:getPublicPingTasks` 和 `public:getPingMetricStats`。公共设置仍从 `/api/public` 获取，版本使用 `common:getVersion`。主通道是 `/api/rpc2` HTTP/WebSocket；每五秒查询实时状态，隐藏或卸载页面关闭连接。

`public:queryMetrics` 接收 `entity_id`、`metric_keys`、`hours`，返回带 `metric_key/entity_id/unit/interval_seconds/points` 的序列；CPU 百分比、内存/磁盘 bytes、网速 B/s，Ping ms、丢包率百分比。保留源桶真实时间、零值和 null；图表只插入空断点，不生成数值样本，不使用 EWMA、插值或当前容量回填历史。新请求清除旧范围图，错误明确显示。

支持相对历史范围，拒绝任意起止日期及非源桶聚合请求。源端不提供逐包计数与分位数，所以 `public:getPingMetricStats` 返回空统计及明确限制，丢包率由独立源桶曲线呈现。管理、终端、安装恢复页面、临时密钥 cookie 入口与 PWA 注册未纳入公共应用。

固定安装 profile 为 `komari-default-bed58b5`，适配包为 `LeoBridgeKomariDefault / bed58b5-leobridge.1`。验收见[官方前台验收](komari-default-acceptance.md)。升级安装会新增不可变版本；在后台启用新包，旧安装保留供回退。

## 旧便签纸适配记录

以下保留旧版本的来源、契约与历史说明，不代表当前默认前台。


2026-11-02。选用官方Komari商店目录中的 **Adhesive Note v1.0.0**，仓库 [stqfdyr/komari-theme-adhesive-note](https://github.com/stqfdyr/komari-theme-adhesive-note/tree/8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914)，固定提交 `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`。不是自造占位界面。

官方 `komari-monitor/komari-web` 固定源码 `bed58b589da63232a17681b1dbaed9eab2423078` 的归档没有LICENSE，GitHub元数据license=null，故未复制为应用。Adhesive Note自身MIT，完整原始许可及字体/图形许可放在 `web/themes/komari/`；原作者也明确其RPC客户端是独立实现而非复制官方未授权前台。

## 原始包与本地适配分开

官方商店原包short=`AdhesiveNote`、version=`1.0.0`，目录SHA-256为`94f69c657413e7b3204cfea0bce94f1ee5deb1f897364664b27367b592d49c80`。该摘要**不代表本地修改后构建**。

应用副本 `web/themes/komari/` 保存原始文件哈希 `UPSTREAM.json` 和 `PATCHES.md`。构建 `node scripts/build-komari.mjs` 输出 `dist/komari-public/`，生成清楚区分的manifest short=`LeoBridgeAdhesiveNote`、version=`1.0.0-leobridge.1`，保留原作者/来源。运行依赖由根锁文件统一固定，无需执行参考目录的打包/字体生成脚本。

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
