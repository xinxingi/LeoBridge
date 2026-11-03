# 历史反向代理测试夹具

仅供 `scripts/verify-container.mjs` 的隔离本机合成测试使用，保留 TLS、代理来源校验及容器换 IP 的回归场景，不随 Docker 部署交付。脚本仍依赖历史主题安装和已初始化管理状态，当前不能直接作为空镜像验收。此处的 nginx、证书、固定网段只属于测试环境。

实际用户入口是 `deploy/docker/compose.yaml`，只启动 LeoBridge。
