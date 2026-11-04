# Docker 部署

只需一个`compose.yaml`，直接在文件里改配置，不再需要`.env`。密码、数据源和主题保存在同目录的`./data`，不使用Docker命名卷。Docker只运行应用，Caddy/nginx及证书由你现有的服务管理。

本页模板须搭配包含HTTP接入简化的新版镜像，镜像已内置运行默认值；旧镜像不能仅替换模板后省略参数。旧Release附件不会自动更新。已有命名卷部署先按下方“旧命名卷迁移”处理，不能直接换成空data目录。

## 下载和首次启动

准备Docker Engine和Docker Compose v2，取得与版本对应的[Compose模板](../../deploy/docker/compose.yaml)。支持amd64/arm64

部署目录如下：

```text
LeoBridge/
├── compose.yaml
├── data/             # 密码、数据源、主题和会话；升级时保留
└── tmp/              # 下载、解压和构建的临时文件，不需要备份
```

以下是`data`和`tmp`尚不存在的新安装步骤，已有部署先按迁移说明操作。在该目录执行。创建目录和设置权限的命令需要root，非root账号在对应命令前加sudo：

```sh
mkdir data tmp
chown 1000:1000 data tmp
chmod 700 data tmp
docker compose config --quiet
docker compose pull app
docker compose up -d --no-build
docker compose logs --tail=30 app
```

镜像使用UID/GID1000运行。启动前创建data和tmp并设置上述权限；否则Docker自动创建的目录可能归root所有，应用无法写入。

> Compose的`BRIDGE_ORIGIN`只需填写浏览器实际访问地址; 
> 
> 通过HTTPS域名访问时改为`https://monitor.example.com`即可

```yaml
environment:
  BRIDGE_ORIGIN: http://127.0.0.1:8787
```

⚠️ 默认只允许服务器本机访问 `http://127.0.0.1:8787/admin` 全新数据用 `admin/admin` 登录并按提示改密，再到“设置 → 数据源”保存主控配置。


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
tar -czf "backups/data-$(date +%Y%m%dT%H%M%S).tar.gz" data compose.yaml
chmod 600 backups/*.tar.gz
docker compose up -d
```

## 升级与排障

升级前备份data及Compose；`docker compose pull app`后执行`docker compose up -d --no-build`，保持同一data目录。


日志查看: `docker compose logs --tail=100 app`

遇到`STORAGE_PERMISSION`，使用默认挂载时，在Compose目录以root或sudo修复（自定义路径或运行用户按实际调整）：

```sh
mkdir -p data tmp
chown -R 1000:1000 data tmp
chmod 700 data tmp
docker compose up -d --no-build app
```