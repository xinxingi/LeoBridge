# 部署检查入口

推荐使用 Linux VPS 和 Docker Compose 部署。根据运行环境选择对应指南：

- [VPS部署指南](deployment/vps.md)：Docker Compose/nginx、域名/TLS、持久化、备份恢复、升级回退及部署检查。
- [SSH私有测试](deployment/ssh-test.md)：通过SSH隧道访问仅监听回环地址的测试实例。
- [配置参考](configuration.md)：上游、身份绑定及独立访问控制。
- [Workers实验性部署参考](deployment/workers.md)：运行时资源、域名与验证要求；尚未完成云端部署验证。

部署后使用实际前台检查首页、详情、历史和实时更新；进程健康检查不能替代这些检查。
