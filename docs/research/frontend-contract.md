# 固定默认前台契约审计

2026-11-02；固定提交 `609cc0b0998793510453be8eadced2064b28ad7d`。完整前台从该提交归档复制至 `web/themes/cfsm/`，没有执行参考目录或复制完整CFSM后端。来源、许可证、文件哈希及补丁范围见 `web/themes/cfsm/UPSTREAM.json`、`web/themes/cfsm/LICENSE`、`web/themes/cfsm/PATCHES.md`。

## 实际消费者

| 路径 | 请求和消费形状 |
| --- | --- |
| `/api/config` | 直接配置对象；site_title、show_price/show_expire/show_tf、display_mode、default_language、theme_options、frontend_ws_timeout_minutes；LeoBridge新增 bridge.history_hours/history_note |
| `/api/servers` | 对象含 servers 数组、stats、regionStats、sysConfig；each server.id用于路由及WS订阅 |
| `/api/server?id=…` | 直接服务器对象，不包 `{server:…}`；可有sysConfig和latestReportUpdates |
| `/api/history/all?id=…&hours=N` | 直接行数组；每行timestamp和该时刻真正可得的指标。时间以毫秒传入 `new Date()` |
| `/api/ws?subscribe=all` 或serverId | 客户端open后发送 `{type:'subscribe',scope:'all'或id,ids:[…]}`；`batchUpdate` 的updates为数组，各项`{serverId,samples:[{ts,data}]}`；主消息ts及sample.ts毫秒 |

根路由为 `/#/`，详情为 `/#/server/:id`。静态构建产物含index.html及哈希assets；flags、os-icons、favicon本地供应。Vite构建不嵌入 `.dev.vars`，API保持同源。前台没有主控URL和密钥。

## 单位与状态

- ram/disk/swap *_used/*_total 被消费者乘1024²后交给formatBytes，协议单位MiB。
- net_in_speed/net_out_speed是B/s；net_rx/net_tx及周期累计是byte；traffic_limit被乘1024³，协议单位GiB。桥接器不因字段名字相近就映射不同累计口径。
- boot_time消费者可接受秒或毫秒；桥接器标注`boot_time_estimated`。observed_at/last_updated仅桥接观察时刻，不是Agent采样时刻。
- 上游原版仅依据last_updated近60秒推断在线；本适配改为显式online与45秒数据新鲜度（依据本次真实慢传输观察，仍不声称源端5秒节奏）分别判断。未知在线状态显示未知，上游不可达显示过期，不能变成服务器离线。
- 缺省/无效系统指标不映射0；CPU、网速、丢包、Ping真实0被保留。未配置ping/loss=false不展示；明确超时null与无采样缺失应由后端区别。
- 原版历史切换大于24小时会弹CFSM登录，本适配删除该门槛，以桥接能力列表和服务端验证为准。历史数据错误显示于图表上方，不伪报成功。
- 原版图表按约120个点推算缺口；源端聚合桶数不同。本适配消费`bridge.history_bucket_seconds`，以实际桶宽判断间断，6H/48H等范围不会因此被错误拆成孤点。

## 边界及资源

只供应固定默认展示前台。管理员入口、可选地图、财务汇率、Mikus资源不开放；不请求外部字体和汇率。默认卡片、列表、环形卡片和详情仍来自上游，未重写成自造示例界面。没有地图地理信息或资产权利的扩展承诺。

根工程通过固定依赖和锁文件构建；前台依赖Vue、Vue Router、Chart.js及Vite/plugin-vue。桥接核心TypeScript与上游JavaScript/Vue展示代码分离。

## 本阶段已执行

- `node scripts/build-frontend.mjs`：成功，67个模块，输出dist/public；这是构建证据。
- `node --test frontend/tests/bridge-state.test.js`：4项通过，覆盖显式离线、未知状态、过期、故障与恢复；使用合成对象，不是真实主控证据。此处保留当时命令，目录迁移后的路径为`web/themes/cfsm/tests/bridge-state.test.js`。
- 主代理统一浏览器验收通过：真实首页11台、卡片/列表、详情与实时数值更新；1H CPU、6H聚合CPU、7D连接/Ping/丢包曲线实际渲染，初始缺测留空。授权代理接入后的最终IAB应用error日志为空。合成离线/缺省/零值和Workers资源另外验证；证据边界见[验收记录](acceptance.md)。
