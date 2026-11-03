# 部署验收入口

当前优先VPS。用户已提供测试服务器并选择SSH隧道私有测试；实例已运行，真实接口与运维检查通过，浏览器权限仍阻塞该环境的页面验收。未开放公网展示、未推送或发布，Cloudflare后置。

- [VPS部署指南](deployment/vps.md)：Docker Compose/nginx、身份配置、域名/TLS、持久化、备份恢复和升级回退；文末列出目标VPS验收项。
- [SSH私有测试](deployment/ssh-test.md)及[实际记录](research/vps-private-acceptance.md)：代理连接、回环端口、真实接口/实时、恢复证据与浏览器阻塞。
- [配置参考](configuration.md)：本地/反代模式及独立访问控制。
- [Workers后续草案](deployment/workers.md)：保留既有配置与未完成云验收，当前后置。
- [开发进度](progress.md)：按实际运行区分源码测试、本机模拟、Docker/nginx/systemd及真实服务器验收。

任何本地构建或合成检查都不能标记为已上线。
