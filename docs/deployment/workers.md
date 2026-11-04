# Cloudflare Workers（后续支持）

当前优先完成[Docker部署](docker.md)和[本地Node部署](local.md)。Cloudflare Workers暂不作为已支持的部署方式，也不要求当前改动同步完成其兼容验收。

仓库保留Worker入口、Wrangler配置及R2/DO存储实现，供后续适配。历史本地模拟或dry-run只说明当时的检查结果，不能证明当前版本已在Cloudflare云端可用。

后续恢复这项工作时，需要验证上游HTTP/WS访问、主题安装与资源读取、管理认证和数据源配置持久化、域名/TLS路由、额度与费用，再补充部署步骤。现阶段无需为此创建云资源或准备Cloudflare凭据。

配置概念与Node统一为single单站点及BRIDGE_ORIGIN，默认不列独立展示域/预览域。Workers没有宿主目录，业务数据仍通过现有R2/DO保存；Node的./data不适用于云端存储。
