# 部署方式

普通用户使用预编译产物，目标机器不安装开发工具或编译。

| 方式 | 操作 | 当前交付状态 |
| --- | --- | --- |
| [本地运行包](deployment/local.md) | 下载对应平台的运行包，校验后解压并用脚本启停 | [v0.2.0 Release](https://github.com/xinxingi/LeoBridge/releases/tag/v0.2.0)，Linux x64 / arm64 |
| [Docker Hub镜像](deployment/docker.md) | 默认使用0.2.0镜像，Compose拉取并运行，命名卷持久化 | [staractive/leobridge:0.2.0](https://hub.docker.com/r/staractive/leobridge/tags)，linux/amd64、linux/arm64 |

构建源码、制作运行包和自行构建镜像统一见[开发文档](development/build.md)。Cloudflare Workers暂未作为支持的部署方式。

默认只监听或映射部署机器的回环地址。远程服务器上的`127.0.0.1`不是访问者电脑；首次设置可用SSH隧道，对外站点按[单域名反代](deployment/reverse-proxy.md)配置HTTPS。下载运行包与启动镜像不需要主控Token，首次登录改密后再在后台保存数据源。

部署后检查管理登录、数据源保存、主题安装与预览、首页/详情/历史及实时更新；重启后确认配置和主题状态仍在。进程健康检查不能替代实际页面检查。配置参数见[配置参考](configuration.md)。
