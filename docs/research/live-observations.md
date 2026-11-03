# 真实主控只读核验

日期：2026-11-02。主控及Agent版本未知。具体地址、Token、服务器名称和原始指标不写入本文。请求使用用户提供的 `X-MMwx-Probe-Token`；未做无Token对比，因此不能证明接口保护是否开启。

## 后续保护开启对照实验

用户明确重新开启“保护探针数据接口”并提供轮换后的密钥。本地 `.dev.vars` 已更新；无凭据写入仓库。对同一 `/api/public/probe-servers` 接口并行只读对比：

- 携带新 `X-MMwx-Probe-Token`：HTTP 200，约3.23秒，enabled=true，11台服务器全部在线。
- 不携带Token：HTTP 404，约4.14秒。

本次对照支持“保护开启时正确密钥可访问、无密钥被拒绝”。上文未做对照的限定只适用于之前的测试。之前的连接/TLS超时不能归因为鉴权拒绝。未测试旧密钥、错误密钥或WebSocket，不能扩展结论。

## 已成功

- `GET /api/public/probe-servers`：HTTP 200，约2.83秒，enabled=true、show_name=true，11台服务器均online=true。
- `GET /api/public/probe-series?server=0&metric=ping&range=1h&all=1`：HTTP 200，success=true、bucket_sec=300。
- Ping响应：generated_at为整数（具体时间单位待比对）；series为对象，包含key/label/current_ms/loss_pct/buckets；all_series为数组，本次9个目标，额外包含isp。每个buckets数组长度12，元素字段ms/loss。本次桶未观察到显式时间戳，后续需确认时间对齐规则。

## 与文档摘录的差异

- 顶层含 `history_days: 7`、`icon`、`tri_isp` 及多个 `show_*` 开关。
- 服务器字段含 `boot_traffic_up/down/scope`、`cumulative_traffic_scope`、`daily_traffic_start/end/scope`、`traffic_used_scope`、`traffic_source`、`traffic_stats_mode`、`traffic_adjustment`、`tcp_connections`、`udp_connections`、`conn_history`。
- 上述字段仅确认存在，不据名称推定完整语义。
- history_days=7是能力调查线索，不证明range=7d或hours=168可以调用。需要核对新版文档或真实前端请求，再验证具体参数。先前“只能24小时”的判断仅基于旧文档列举，不能作为当前主控结论。

## 初次调查时未完成（后续结果见下文）

- system一小时历史：超时/HTTP2错误/TLS握手超时，均未取得HTTP响应；不能归因于接口业务错误。
- WebSocket、6h/24h及更长历史、离线响应、名称隐藏响应未采集。
- 原始快照和Ping历史在 `work/private/`（Git忽略）；没有发布脱敏的observed fixtures。4份既有synthetic fixtures仍是合成数据。

## v0.1开发轮只读调查（2026-11-02）

本轮使用现有 `.dev.vars` 密钥；未修改主控、重排服务器、重启服务或轮换密钥。为追踪真实消费契约，只读获取了主控首页和首页列出的公开探针JavaScript片段；没有执行混淆脚本，没有下载或修改服务端代码。

### 已确认历史能力

所有下列请求使用 `server=0`；这是当时公开数组下标，只用于契约采样，不构成永久身份绑定。

| metric / range | 结果 | 桶及采样 | 本地私有证据名 |
| --- | --- | --- | --- |
| system / 1h | HTTP200，success=true；前两次传输超时后成功 | 300秒，预期12桶，各字段12点 | system-1h-third |
| system / 6h | HTTP200，success=true | 600秒，36桶/点 | system-6h |
| system / 24h | 首次TLS超时；重试HTTP200，success=true | 1800秒，48桶/点 | system-24h-retry |
| system / 7d | HTTP200，success=true | 7200秒，预期84桶；各字段52或53点 | system-7d |
| ping / 1h / all=1 | HTTP200，success=true（本轮重新核实） | 300秒，9目标各12桶 | ping-1h-current |
| ping / 6h / all=1 | HTTP200，success=true | 600秒，9目标各36桶 | ping-6h |
| ping / 24h / all=1 | HTTP200，success=true | 1800秒，9目标各48桶 | ping-24h |
| ping / 7d / all=1 | HTTP200，success=true | 7200秒，9目标各84桶 | ping-7d |

证据保存在 `work/private/live-contract/<证据名>.raw` 及脱敏结构摘要 `.summary.json`，不纳入Git。本轮1h Ping也重新成功，已覆盖1h/6h/24h/7d四档的system及Ping。

`history_days=7`现在有真实`range=7d`系统/Ping成功响应支持，不能再将24小时写成当前主控上限。7d系统实际采样少于预期桶数，**没有证明存在完整七天历史**。不同指标长度不一，需要按各自`t`对齐；不可按数组下标配对或补造缺失点。

`generated_at`和系统`t`为Unix秒。Ping桶没有`t`，但实际主控前台已明确其时间算法：最后桶为`generated_at - generated_at % bucket_sec`，更早的桶按`bucket_sec`倒推。取得的脚本片段包含完整相关表达式；详细边界及材料摘要见 [输入契约](upstream-contract.md)。7d Ping共756个目标桶中288个为`ms=-1,loss=-1`，这是无数据，不是0延迟或确认超时。

### 流量与稳定身份

实测范围标签：计费用量是`configured_period`，来源为`xray`，计费模式包含`both`和`upload`；网卡累计及开机累计为`current_boot`。此观察足以反对将套餐用量机械映射成网卡总量/自然月流量，但没有独立标定所有流量计算。服务器仍无公开稳定ID；只读采样未改变名称或排序，未证明这些属性稳定。

### WebSocket传输

携带`X-MMwx-Probe-Token`的curl HTTP/1.1 Upgrade两次得到HTTP101，并各解出一个完整约63KB的文本JSON帧：结构直接等同快照，含11台服务器。没有CFSM `hello` 或 `batchUpdate` 包装。

首轮限时30秒、第二轮60秒；第二轮还收到了下一帧的部分字节，未收完整。达到采样上限后工具断开（curl退出28），应分别记录已通过的握手/首帧与未完成的连续消息验收。Python socket方式前两次在TLS阶段超时，未取得HTTP响应；不能当作鉴权失败。第三轮延长到120秒仍HTTP101，但因传输缓慢只收到不足一个完整快照的字节，未解出完整帧。实际主控前台不发送订阅帧，关闭后使用5秒HTTP轮询回退。

随后使用项目实际Node `ws`依赖（8.18.3）读取同一接口：HTTP101，约1.30秒建连，约9.30秒及40.28秒收到两个完整且内容不同的快照（各11台，CPU/网络指标发生变化）。因此**连续快照传输已验证**，但本网络条件下完整帧到达间隔约31秒，未验证文档所述5秒节奏或长期稳定性。60秒采样上限后客户端主动terminate（本地close_code=1006），不是上游主动异常关闭证据。原始私有证据为`websocket-node-0.json`、`websocket-node-1.json`及`websocket-node.summary.json`。运行时应按最后完整快照时间判过期，并支持HTTP刷新回退；不能把连接仍打开当成数据始终新鲜。

### 仍未验证

真实离线、名称隐藏、采集关闭、服务器重排/改名，以及Workers到主控的实际运行链路仍未验证；本轮没有为了制造这些情景而修改主控。主控及Agent具体版本仍未知。本文件记录的上游联调不等同于LeoBridge前台浏览器验收或Workers部署验收。

### 授权代理及最终桥接验收

后续经用户授权使用127.0.0.1:7897并核实HTTP CONNECT/SOCKS5协议。同一1h system请求直连15秒未完成TCP，代理约0.96秒取得完整200；代理原生WS45秒取得9个完整快照（5种内容）。Node显式接入HTTP/WS代理后，两轮桥接全部用例通过；最终构建1h/7d均200、两批原生WS指标变化、close1000。实际固定前台首页、详情、1H/6H/7D历史和实时更新亦通过。详见[代理观察](proxy-observations.md)和[独立验收记录](acceptance.md)。旧失败不删除，不据限时采样宣称长期稳定。

本地workerd合成全链路通过，真实主控仍超时，包括仅设置Wrangler代理环境变量的对照。Cloudflare云端没有部署，仍待部署验收。

### 双生态收尾观察

双协议并发复验已取得真实1h/7d系统与Ping，见[本轮验收](dual-store-acceptance.md)。运输层失效共享缓存导致的桥接503已修复且回归；它与直接源WS诊断的HTTP503是不同问题。源WS一次只读握手返回503，原因未知；CFSM末两个90秒采样仅有HTTP回退，未记为原生通过。Komari同轮有两次原生观察；既有原生成功也不代表长期稳定或无限并发。未改动主控配置、顺序、密钥或服务。
