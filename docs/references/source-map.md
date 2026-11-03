# CFSM 固定源码路径索引

固定提交：`609cc0b0998793510453be8eadced2064b28ad7d`。仅保存参考片段，没有安装或执行上游代码。

| 本地文件 | 用途 | 固定上游链接 |
| --- | --- | --- |
| [package.json](upstream/cfsm-source/package.json) | 上游构建脚本入口和依赖声明 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/package.json) |
| [src/durable/MetricsBroadcaster.js](upstream/cfsm-source/src/durable/MetricsBroadcaster.js) | CFSM实时广播与订阅实现 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/src/durable/MetricsBroadcaster.js) |
| [src/frontend/utils/api.js](upstream/cfsm-source/src/frontend/utils/api.js) | 前端实际HTTP请求及WebSocket连接/订阅工具 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/src/frontend/utils/api.js) |
| [src/frontend/views/Dashboard.vue](upstream/cfsm-source/src/frontend/views/Dashboard.vue) | 首页消费字段、刷新与展示 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/src/frontend/views/Dashboard.vue) |
| [src/frontend/views/ServerDetail.vue](upstream/cfsm-source/src/frontend/views/ServerDetail.vue) | 详情与图表、历史范围、实时合并 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/src/frontend/views/ServerDetail.vue) |
| [src/handlers/dashboard.js](upstream/cfsm-source/src/handlers/dashboard.js) | CFSM公开REST响应实现 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/src/handlers/dashboard.js) |
| [wrangler.toml](upstream/cfsm-source/wrangler.toml) | 原项目Worker配置；不可直接当桥接器配置使用 | [查看](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/wrangler.toml) |

下一轮审计需继续定位：HTTP封装与认证、前台路由及入口、容量/网速格式化、图表组件、静态构建脚本、锁文件和flags/os-icons资源。通过固定提交的目录树定位后下载，不猜路径，也不宣称当前副本是完整前端。

以上材料适用上游 MIT 许可证。更新时统一更新提交、文件及 manifest。
