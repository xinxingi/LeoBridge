# 妙妙屋X探针 API：人工整理摘录

本文保留读取当日的文档摘录；历史档位、Ping时间对齐和WS的后续实测见[输入契约](../research/upstream-contract.md)。下文“需确认”描述摘录当时的信息缺口。

来源：https://miaomiaowux.com/docs/probe-api/

读取日期：2026-11-02；网页更新日期：2026-10-31。以下为浏览器所见正文的技术摘要，不是实测、完整原文或官方 schema。

## 通道

- `GET /api/public/probe-servers`：当前状态及近一小时延迟摘要。
- `WS /api/public/probe-ws`：每 5 秒推送相同快照结构。
- `GET /api/public/probe-series`：延迟或系统历史。
- 独立探针开启接口保护后需 `X-MMwx-Probe-Token` 请求头。探针或通道未开启通常返回 404。WebSocket 握手的具体行为仍需联调。

## 快照

顶层：`enabled`、`title`、`logo`、`appearance`（theme/color_mode/revision）、`block_login`、`show_name`、`show_globe`、可选 `license_badge`、`servers`。

关闭探针时只保证 `enabled` 存在。服务器列表是管理员选定的公开范围。

| 字段 | 文档含义 |
| --- | --- |
| name | 受名称显示开关控制 |
| online | Agent WebSocket 或数据库状态是否在线 |
| last_seen | ISO 8601，只在服务器离线时返回 |
| region | 地区 Emoji |
| region_country / region_name / region_city | 国家、完整地域、城市；国家编码格式需实测 |
| provider_name / provider_url | 服务商及 HTTP(S) 链接 |
| cpu_pct / loadavg | CPU 百分比、负载文本 |
| mem_used / mem_total | 字节 |
| disk_used / disk_total | 字节 |
| upload_speed / download_speed | B/s |
| uptime | 秒 |
| cpu_model / cpu_cores / cpu_threads | 型号、核心、线程 |
| os / kernel / arch | 系统、内核、架构 |
| traffic_used / traffic_limit | 当前计费周期用量与限额，字节；限额 0 表示不限 |
| traffic_used_up / traffic_used_down / traffic_used_total | 当前周期实际上下行与合计，字节 |
| cumulative_up / cumulative_down | 系统网卡当前周期累计上下行，字节 |
| period_start / period_end | YYYY-MM-DD，起点含、下一重置日不含 |
| daily_traffic | date/uplink/downlink/total，每日流量，字节 |
| expires_at | 到期日期，可回退到下一流量重置日 |
| renewal_price / renewal_currency | 原币金额与 ISO 货币代码 |
| renewal_cycle | month/quarter/half_year/year |
| renewal_price_cny | 按许可证服务器汇率折算人民币 |
| ping | key/label/isp/current_ms/loss_pct/buckets |
| return_routes | carrier/region/route_type/tested_at |

Ping 摘要包含 12 个五分钟桶；桶内 ms 为平均延迟、loss 为 0–100 丢包率，-1 表示无数据。该规则不能直接推广到所有顶层 Ping 字段，需确认具体响应。

## 历史

- `server` 是当前 servers 数组下标，不是数据库 ID。
- `metric=ping`（默认）或 `system`；`target` 为 ping key；`all=1` 返回全部目标。
- `range=1h`：12 × 5 分钟；`6h`：36 × 10 分钟；`24h`：48 × 30 分钟。
- 通用响应字段：success、bucket_sec、generated_at、series；all=1 额外含 all_series。
- system 指标：cpu_pct、mem_used、mem_total、upload_speed、download_speed、cumulative_up、cumulative_down。每项为 `{t: Unix秒, value: 数值}` 数组。
- 文档没有完整定义 ping 历史的 JSON 嵌套样例、generated_at 类型和所有无数据情况，需要采集真实脱敏响应。

## 缺省与身份

采集开关关闭、Agent 不支持或尚无数据时，多数指标直接缺省，不返回 0。

接口不返回服务器 ID、IP、Token、Agent 地址、主机名或 Xray 配置。仅用数组下标无法承诺排序变化后身份稳定；没有可辨识属性时，持久化一个随机 UUID 也不能解决重新匹配问题。
