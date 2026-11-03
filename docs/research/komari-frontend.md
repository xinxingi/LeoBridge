# 真实 Komari 前台实现与契约

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
