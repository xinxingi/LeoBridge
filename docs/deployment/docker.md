# Docker 部署

只需一个`compose.yaml`，直接在文件里改配置，不再需要`.env`。密码、数据源和主题保存在同目录的`./data`，不使用Docker命名卷。Docker只运行应用，Caddy/nginx及证书由你现有的服务管理。

本页模板须搭配包含HTTP接入简化的新版镜像，镜像已内置运行默认值；旧镜像不能仅替换模板后省略参数。旧Release附件不会自动更新。已有命名卷部署先按下方“旧命名卷迁移”处理，不能直接换成空data目录。

## 下载和首次启动

准备Docker Engine和Docker Compose v2，取得与版本对应的[Compose模板](../../deploy/docker/compose.yaml)。镜像直接写在`services.app.image`，默认[staractive/leobridge:latest](https://hub.docker.com/r/staractive/leobridge/tags)，支持amd64/arm64；需要锁定版本时改为已发布的版本标签或摘要。Release入口见[部署方式](../deployment-checklist.md)。

部署目录如下：

```text
LeoBridge/
├── compose.yaml
├── data/             # 密码、数据源、主题和会话；升级时保留
└── tmp/              # 下载、解压和构建的临时文件，不需要备份
```

以下是data和tmp尚不存在的新安装步骤，已有部署先按迁移说明操作。在该目录执行。创建目录和设置权限的命令需要root，非root账号在对应命令前加sudo：

```sh
mkdir data tmp
chown 1000:1000 data tmp
chmod 700 data tmp
docker compose config --quiet
docker compose pull app
docker compose up -d --no-build
docker compose logs --tail=30 app
```

镜像使用UID/GID1000运行。启动前创建data和tmp并设置上述权限；否则Docker自动创建的目录可能归root所有，应用无法写入。`./data`和`./tmp`相对于Compose文件所在目录，不是随意执行命令时的工作目录。配置就是`./data:/data`与`./tmp:/tmp`两条普通目录映射，不创建Docker命名卷。

默认只允许服务器本机访问`http://127.0.0.1:8787/admin/`，远程通过SSH隧道或下方HTTPS反代访问。全新数据用admin/admin登录并按提示改密，再到“设置 → 数据源”保存主控配置。主控Token和管理密码不用填入Compose。

## 只填站点地址

Compose的environment只需填写浏览器实际访问地址，不含/admin/或末尾/：

```yaml
environment:
  BRIDGE_ORIGIN: http://127.0.0.1:8787
```

通过HTTPS域名访问时改为`https://monitor.example.com`即可。应用始终接收HTTP请求，HTTPS、证书及HTTP跳转HTTPS由nginx/Caddy负责；不用切换proxy模式或填写Docker网关。

NODE_ENV、监听地址/端口、数据路径及公开展示策略已内置在镜像；程序默认single，让首页、后台和预览共用同一站点。后台始终需要登录。高级隔离、展示密码或可信客户端IP需求另见[配置参考](../configuration.md#高级配置与访问控制)，默认模板不再罗列它们。

端口直接改ports左侧，例如`127.0.0.1:8788:8787`；容器内部8787不用改。HTTP直连时也把站点地址端口改为8788；HTTPS反代的BRIDGE_ORIGIN填写外部HTTPS地址，代理上游端口改为8788。

## 对接已有反向代理

以Caddy/nginx运行在宿主机为例，保留`127.0.0.1:8787:8787`映射：

1. 把Compose中的BRIDGE_ORIGIN改为自己的HTTPS地址，例如`https://monitor.example.com`。
2. 按[Caddy/nginx示例](reverse-proxy.md)将该域名整站转发到`http://127.0.0.1:8787`，保留原Host、路径、查询参数、Referer、Origin、Cookie和WebSocket。修改代理配置后校验并重载代理。
3. 应用配置修改后重建容器：

   ```sh
   docker compose config --quiet
   docker compose up -d --no-build --force-recreate app
   docker compose logs --tail=30 app
   ```

日志仍为direct listener，这是正常的HTTP监听；浏览器进入`https://monitor.example.com/admin/`。只有修改代理配置才需要重载代理，单纯修改Compose无需重载Caddy。仅restart不会更新应用环境。新版镜像还支持启动前执行`docker compose run --rm --no-deps app node dist/node.js --check-config`，旧镜像不要执行此命令。

若代理也运行在Docker容器内，使用双方可达的共享网络，将上游设为应用服务名及8787端口，不能使用代理容器的127.0.0.1。默认不采信转发IP头，管理登录限流按实际连接来源计算；同一代理的访客共享该来源限流。如确需按真实客户端IP区分，才使用[高级proxy配置](../configuration.md#node运行参数)。

已有文件名为docker-compose.yml时继续使用它，命令加`-f docker-compose.yml`，不要并排放两份配置。固定YAML值不受旧.env控制。健康检查仅确认应用进程，不能替代后台登录、主题预览及真实HTTP/WSS验证。

## 数据、备份和恢复

`./data/state.json`保存管理凭据、数据源和会话，`./data/packages/`保存主题资源。备份整个data目录，不单独复制state.json。数据目录只供一个实例使用；不执行多副本扩容。

停机后备份，以下权限操作以root执行：

```sh
docker compose stop app
mkdir -p backups
chmod 700 backups
tar -czf "backups/data-$(date +%Y%m%dT%H%M%S).tar.gz" data
chmod 600 backups/*.tar.gz
docker compose up -d
```

同时保存compose.yaml。恢复时先停止应用，将备份解压到新的空目录，保留当前data用于回退；确认备份完整后将恢复的data放回Compose旁边，恢复UID/GID1000及私有权限，再启动。不要向运行中的目录覆盖解包。验证登录、数据源、主题资源及实时连接后再清理旧副本。备份包含凭据，不公开分享。

## 旧命名卷迁移

已有部署**先使用原Compose停止应用**，保留原文件和卷。以下默认容器名与旧模板一致；若曾改项目名，使用自己的原容器名。部署目录内data必须尚不存在：

```sh
docker compose stop app
# 从停止的旧容器复制完整数据；不读取或输出凭据内容。
docker cp leobridge-app-1:/data/theme-store ./data
chown -R 1000:1000 data
chmod 700 data
```

确认复制成功并备份后，再将原Compose的存储改为新版`./data → /data`，同时把BRIDGE_THEME_STORE改为`/data`，然后重建应用。旧容器必须保留到复制完成；不要先替换Compose或删除旧卷。若data已存在，先核对其来源，勿将旧数据混入另一实例。迁移后沿用原密码、Token、稳定ID和主题；旧卷保留到验收完成。不执行`down -v`清除旧卷。

## 升级与排障

升级前备份data及Compose；`docker compose pull app`后执行`docker compose up -d --no-build`，保持同一data目录。latest不会自动更新运行中的容器。回退使用事先记录的固定版本/摘要；状态格式不兼容时恢复对应版本的完整备份，主题回退不能替代应用回退。

根文件系统只读，容器/tmp通过`./tmp:/tmp`映射到Compose旁的磁盘目录，用于下载、解压及原生主题临时依赖。不再使用tmpfs或512MiB上限，容量取决于宿主磁盘。应用正常完成任务时清理对应工作目录，停止或重建容器不会自动清空宿主tmp；异常残留可在停止应用后清理tmp内容，保留目录及UID/GID1000、0700权限。tmp无需备份，data须保留。已有部署新增映射前先创建tmp并设置权限，再重建容器。容器不会读取宿主的.dev.vars。

先查看`docker compose logs --tail=100 app`。新版在监听前检查数据目录读写，运行中写入失败也会明确报告权限、只读或磁盘空间问题，不再仅显示“桥接器内部错误”。这些改进需升级到包含修复的镜像；临时目录问题不阻止后台启动。

遇到`STORAGE_PERMISSION`，使用默认挂载时，在Compose目录以root或sudo修复（自定义路径或运行用户按实际调整）：

```sh
mkdir -p data tmp
chown -R 1000:1000 data tmp
chmod 700 data tmp
docker compose up -d --no-build app
```

已运行的服务恢复权限后可直接重试登录；启动失败的服务查看日志确认恢复。不要删除data或state.json来处理权限错误。运行包使用实际服务账号，不照抄Docker的UID1000。UNKNOWN_HOST核对站点地址及Host；UNTRUSTED_PROXY核对实际代理来源。完整说明见[排障](../troubleshooting.md)。
