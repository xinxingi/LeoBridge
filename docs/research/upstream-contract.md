# 妙妙屋X实测输入契约

核验日期：2026-11-02。依据为授权主控的只读响应和其页面实际引用的探针脚本片段；主控/Agent版本仍未知。本文件不包含地址、Token、服务器名称、真实指标值或原始响应。原始材料只在被忽略的 `work/private/live-contract/`。

## 历史范围与时间

`GET /api/public/probe-series?server=<当前公开数组下标>&metric=system|ping&range=<范围>`；Ping增加 `all=1` 返回所有目标。

| range | bucket_sec | 预期桶数 | 证据 |
| --- | ---: | ---: | --- |
| 1h | 300 | 12 | system与Ping本轮实测；主控前台 |
| 6h | 600 | 36 | system与Ping实测；主控前台 |
| 24h | 1800 | 48 | system与Ping实测；主控前台 |
| 7d | 7200 | 84 | system与Ping实测成功 |

主控前台 `_s` 按 `history_days`（裁剪1–7）生成 1h/6h/24h，以及适用的3d、7d或剩余天数选项；`He`/`cs` 为 2–3天使用3600秒桶，4–7天使用7200秒桶。2d/3d/4d/5d/6d尚未逐档实测，不因前台存在就宣称每档线上验证通过。7d实测返回7200秒桶，排除了静默按1h返回的情况。

系统历史顶层为 `{success,bucket_sec,buckets,generated_at,series}`。`buckets` 是该范围预期桶数整数，**不是实际采样数**。`series` 为指标到 `{t,value}[]` 的映射；`t`、`generated_at`均为Unix秒。当前字段有 CPU、内存、磁盘、网络速率、累计网卡流量、TCP/UDP连接数。各字段独立稀疏：7d系统响应预期84桶，实有52或53点（约四天多），不得补齐或声称已采满七天。实测最后系统时间戳是 `floor(generated_at / bucket_sec) * bucket_sec`。

Ping历史顶层为 `{success,bucket_sec,generated_at,series,all_series}`。`series` 是单目标，`all_series`是目标数组；每目标含 `key/label/isp/current_ms/loss_pct/buckets`（单目标series未含isp）。桶为 `{ms,loss}`，没有独立时间戳。

从主控实际加载脚本的 network history 映射及折线消费代码核实，桶的时间是：

```text
bucketTimestampSeconds = generated_at - generated_at % bucket_sec
                       - (buckets.length - 1 - index) * bucket_sec
```

即最后桶落在当前桶起点；不是 `generated_at - (length-index)*bucket_sec`。转换CFSM时再乘1000。7d Ping实测每目标84桶，其中无数据桶仍为 `ms=-1,loss=-1`；不得把这些桶变为0延迟或100%超时。主控折线代码对负ms断开路径。

只读获取的脚本来自主控HTML列出的 `assets/probe-page-BncDFCNC.js`。传输180秒后中断，已取得180736字节片段，相关完整函数已在片段内；未执行该混淆脚本，未声称取得完整构建或其源码版本。片段SHA-256为 `c9e0be5ca5ae9f09dde52595f9cc4c386bcc631bed3b9bc517eb1c816ba85ea0`。该摘要标识本地截取材料，不代表上游完整文件摘要。

## 流量、缺省与目标身份

文档字节单位与当前字段一致；本次只读观察没有改变采集配置或制造计数变化，单位结论主要来自文档，不能描述为独立标定实验。

- `traffic_source=xray`、`traffic_used_scope=configured_period`，观察到 `traffic_stats_mode=both|upload`。这是计费配置口径，不能当成网卡累计流量，也不能冒充自然月流量。
- `boot_traffic_scope=current_boot` 和 `cumulative_traffic_scope=current_boot`；本主控当前启动周期累计网卡流量可对应同口径展示，勿与套餐用量混用。
- `daily_traffic_scope=configured_period_and_recent_7d`；其命名不证明每个日期完整，未拿它生成系统历史。
- Ping `isp` 实测为 telecom/unicom/mobile，9个目标而非每ISP唯一。必须显式目标key绑定；不可按数组位置或未声明的同ISP唯一性静默选择目标。
- 快照没有已确认的稳定服务器ID。历史`server`参数仍是瞬时公开数组下标。前后快照只能检测可见变化，不能证明请求期间绝无重排/ABA竞态；需要显式身份约束，歧义应失败。

## WebSocket

`/api/public/probe-ws` 支持 `X-MMwx-Probe-Token` 握手头；curl只读Upgrade已取得HTTP101和一个完整文本消息。消息直接是与快照同结构的JSON对象，没有CFSM的`type`包裹，必须转换。随后Node `ws`依赖收到两个内容不同的完整快照，连续消息已验证；本网络下约31秒才收齐下一帧，5秒节奏、重连与长期稳定性未获证实。详细结果见联调记录，不能仅凭连接打开推断数据新鲜。

## 可复现只读采样

`scripts/probe-live.py` 从本地 `.dev.vars` 读取配置，不输出地址或凭据，不跟随重定向。结果存到忽略目录、stdout仅报告结构和状态。示例：

```sh
python3 scripts/probe-live.py '/api/public/probe-series?server=0&metric=system&range=7d' system-7d
python3 scripts/probe-live.py '/api/public/probe-series?server=0&metric=ping&range=7d&all=1' ping-7d
python3 scripts/probe-live.py wscurl websocket
```

这是显式启动的联调工具，不是CI测试。只应对授权主控执行；网络失败会记录为失败，不生成成功样例。`wscurl`限定采样时长后关闭连接，因而HTTP101且已收到帧时curl仍可能以超时码28退出，应分别记录握手/消息成功与采样结束。
