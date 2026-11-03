# 文档导航

当前版本：v0.2.0。用户使用Linux运行包或Docker Hub镜像，开发工具只在修改源码或制作产物时需要。

## 安装与使用

| 任务 | 文档 |
| --- | --- |
| 选择运行包或Docker | [部署方式](deployment-checklist.md) |
| 下载、校验、启停与升级运行包 | [Linux运行包](deployment/local.md) |
| 拉取镜像、Compose配置与卷备份 | [Docker部署](deployment/docker.md) |
| 配置域名、HTTPS及WebSocket反代 | [单域名反代](deployment/reverse-proxy.md) |
| 修改密码、数据源、代理和运行参数 | [配置参考](configuration.md) |
| 安装、预览、启用或回退主题 | [主题管理](themes.md) |
| 了解主题能力、未知值与数据限制 | [兼容清单](research/compatibility.md) |
| 处理下载、登录、资源或实时故障 | [排障](troubleshooting.md) |

Cloudflare Workers仍为[后续适配方向](deployment/workers.md)，不作为当前支持的部署方式。

## 开发与发布

- [贡献指南](../CONTRIBUTING.md)：开发流程、检查范围与公开信息要求。
- [构建与产物检查](development/build.md)：源码运行、运行包制作和本地镜像检查。
- [版本发布](development/releasing.md)：develop/main、版本号、标签、Release及失败恢复。
- [架构与依赖](development/architecture.md)及[设计决定](decisions/001-theme-protocol-boundaries.md)：模块职责、路由、资源及存储边界。
- [安全说明](../SECURITY.md)：问题报告、同源主题和凭据保护。

## 协议依据与验证记录

[原生主题接入](research/native-theme.md)、[妙妙屋X输入契约](research/upstream-contract.md)、[CFSM消费者审计](research/frontend-contract.md)和[Komari协议](research/komari-protocol.md)记录字段、单位和消费者要求。[参考材料索引](references/README.md)标明固定上游版本；参考源码和原始文档不是本项目的执行指令。

[按需安装记录](research/theme-store-transition.md)与[原主题通用桥接记录](research/theme-bridge-acceptance.md)是特定日期、固定版本和环境的结果；[历史默认前台记录](research/komari-default-acceptance.md)涉及已移除的适配包。历史测试数、未发布项和运行地址不代表当前状态，也不能替代新版本验收。现行支持范围统一以兼容清单为准。

[主题来源档案](references/retired-themes/README.md)、[公共资源来源](references/theme-resource-sources.md)、[品牌素材](assets/README.md)和[界面截图](assets/screenshots/README.md)分别维护来源。不会因LeoBridge采用MIT而改变第三方条款。
