# Docker 部署

Docker Compose只启动LeoBridge应用，映射HTTP端口并保存数据卷。域名、DNS、HTTPS证书及反向代理由部署者自己的服务管理，模板不启动nginx或Caddy，不占用80/443。

镜像已发布到[Docker Hub：staractive/leobridge](https://hub.docker.com/r/staractive/leobridge/tags)，可匿名拉取。本文使用固定版本`staractive/leobridge:0.2.0`，支持`linux/amd64`和`linux/arm64`，Docker会选择宿主架构；当前不提供`latest`标签。也可使用`staractive/leobridge@sha256:<镜像索引摘要>`固定内容，摘要从对应版本的Docker Hub标签或成功的发布Actions摘要取得。自行构建见[开发文档](../development/build.md)，目标机器无需Node、pnpm或源码编译。

## 配置及首次启动

准备Docker Engine和Docker Compose v2，从[v0.2.0 Release](https://github.com/xinxingi/LeoBridge/releases/tag/v0.2.0)下载`compose.yaml`和`docker.env.example`到新建的部署目录。也可从同一Git标签的`deploy/docker/compose.yaml`和`deploy/docker/.env.example`取得模板，后者在Release附件中重命名为`docker.env.example`。不要用开发分支模板覆盖已有部署配置。

模板下载受GitHub仓库权限控制，私有仓库需先登录有访问权限的账号；拉取Docker镜像不需要GitHub账号。升级时编辑原`.env`，不要重新复制示例覆盖配置。

```sh
cd /path/to/leobridge-deploy
cp docker.env.example .env
chmod 600 .env
# 编辑 .env，设置 LEOBRIDGE_IMAGE=staractive/leobridge:0.2.0
docker compose config --quiet
docker compose pull app
docker compose up -d --no-build
docker compose ps
```

### 首次打开后台

默认在宿主机打开 `http://127.0.0.1:8787/admin/`。远程服务器部署时通过SSH隧道或配置好的HTTPS反代访问；自己电脑上的127.0.0.1不会直接连到服务器：

1. 全新卷且未自定义账号时，用`admin / admin`登录，设置12–128位、含大小写字母、数字和符号的新密码后重新登录。已有卷使用当前密码。
2. 在“设置 → 数据源”填写主控地址和Token，检查连接、核对节点身份和Ping目标，确认“保存并应用”；不用预填环境JSON。
3. 按[主题管理](../themes.md)安装、预览并启用主题。

后台改密和保存数据源立即生效，统一写入持久卷的`/data/theme-store/state.json`，不在`.env`配置。具体规则及旧版本迁移见[配置在哪里修改和保存](../configuration.md#配置在哪里修改和保存)。

[.env示例](../../deploy/docker/.env.example)只保留每次启动生效的运行参数。`.env`由Compose读取并传入应用环境，运行参数修改后执行`docker compose up -d --no-build`重新创建容器；单独`restart`不会更新容器环境。不要覆盖已有`.env`或把展开后的`docker compose config`、`docker inspect`环境内容贴到工单。

| 可选配置 | 默认与用途 |
| --- | --- |
| `LEOBRIDGE_PORT` | 宿主机端口8787；容器内部始终8787，默认站点源自动使用宿主端口 |
| `LEOBRIDGE_BIND_HOST` | 127.0.0.1，仅宿主机连接；远程访问先完成自有反代对接 |
| `BRIDGE_ORIGIN` | `http://127.0.0.1:<宿主端口>`；实际浏览器站点源，必须与访问地址一致 |
| `BRIDGE_ADMIN_USERNAME` | 当前管理用户名，默认admin；修改后重新创建容器 |
| `THEME_STORE_VOLUME` | leobridge-theme-store；升级保持同一卷名 |

默认使用single路由：`/`展示当前主题，`/admin/`管理。应用在容器内用direct模式监听HTTP，宿主只映射回环端口；无需域名和证书。同源主题能访问同源管理资源，只应预览和启用可信主题；需要主题与后台隔离时改用isolated，见[配置参考](../configuration.md)。single预览与站点同域名同端口，链接使用`?__preview=<安装ID>`，无需额外域名、DNS或证书。

旧实例迁移时保留原卷、后台密码和源配置。旧Compose内的nginx服务、`BRIDGE_*_HOST`、`TLS_DIRECTORY`和固定代理网段不再由模板管理；先按下一节把已有HTTPS站点接到独立反代，再切换应用配置。不要直接覆盖旧部署文件并假定这些旧变量仍生效；旧nginx容器的停用由部署者在确认入口切换后处理。

## 对接已有反向代理

这里只配置LeoBridge如何识别站点和可信代理，不配置代理软件、DNS或证书。宿主上的代理可转发到回环映射端口；代理若运行在另一容器，需自行安排共享网络和可达地址，不能把代理容器里的127.0.0.1当作应用。

在`.env`中补充应用参数，示例如下；域名与代理地址按实际环境填写：

```dotenv
BRIDGE_NODE_MODE=proxy
BRIDGE_ORIGIN=https://monitor.example.com
BRIDGE_ROUTING=single
# 填应用实际看到的代理来源IP/CIDR；Docker转发后的地址可能与宿主不同。
BRIDGE_TRUSTED_PROXIES=<实际代理来源IP>/32
```

默认只需把`monitor.example.com`整站转发到应用同一端口；管理地址为`https://monitor.example.com/admin/`，预览也使用该域名。完整Caddy/nginx示例及可选isolated模式见[单域名反代](reverse-proxy.md)。

代理须保留查询参数、Referer、Host、Origin、Cookie和WebSocket升级头，覆盖`X-Forwarded-Proto=https`及单IP的`X-Real-IP`，清除客户端提供的Forwarded、X-Forwarded-Host和CF-Connecting-IP；应用只接受配置的可信代理来源，不信任任意转发头。历史请求可能接近110秒，代理读超时应覆盖该预算（例如120秒）。对外HTTPS上线前验证Host/Origin、认证及WSS，不能仅靠首页200判断完成。完整参数见[配置参考](../configuration.md#node运行参数)。

应用以UID/GID1000（node）运行，根文件系统只读，仅数据卷和临时目录可写。Compose保留默认bridge网络用于访问主控和主题商店，不配置固定网段。direct/proxy不会自动读取开发`.dev.vars`，不挂载开发私有文件。

## 状态、备份与恢复

`leobridge-theme-store`命名卷挂载至 `/data/theme-store`，保存完整主题包、安装元数据、active/previous指针、数据源凭据、管理密码摘要和会话。首次空卷启动无主题，显示安装引导；重启保留安装及启用状态。`/healthz`只确认本机进程存活，不读取主控，不证明Token、身份、历史或WebSocket正确。Compose健康检查失败会标记unhealthy，单靠该标记不会自动修复上游或重新启动仍在运行的进程。

当前文件存储按**单站、单进程、单副本**运行。文件锁/原子替换不等于共享盘分布式事务；不要 `--scale app`、不要让多台VPS/NFS共同写此目录，也不要由滚动更新临时启动第二写入者。主题切换可以在管理站完成；应用二进制升级需要停机窗口。

以下是停止写入后的整卷备份示例，工作目录仍为部署目录：

```sh
docker compose stop app
BACKUP_DIRECTORY="$HOME/leobridge-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIRECTORY"
chmod 700 "$BACKUP_DIRECTORY"
docker compose run --rm --no-deps --user 0 \
  --volume "$BACKUP_DIRECTORY:/backup" --entrypoint sh app \
  -c 'umask 077; tar -C /data/theme-store -czf /backup/theme-store.tgz .'
docker compose up -d
```

备份位于仓库之外，归属root、权限0600；宿主管理员后续加密/转移时应保留受限访问，按时间/版本保存，避免覆盖。单独加密备份 `.env`；卷备份含管理会话，应按凭据同等级保护。只备份 `state.json`、active指针或镜像不够，必须包含所有 `packages/` 资源。停止后仍有 `state.lock` 时先确认没有其他写入进程，保留原始备份后再按排障文档处理；不可在线删除锁。不能依赖容器内存缓存恢复历史，历史仍在上游。

恢复时先停止应用，将备份解包到一个**新的空命名卷**，恢复UID/GID1000及私有权限，再把`.env`中的`THEME_STORE_VOLUME`改为新卷名后启动。先保留原卷，不向在线卷覆盖解包。验证已安装主题资源、active/previous、管理登录和真实HTTP/WS后才决定清理旧卷。恢复会话会恢复备份时的认证状态，应按自己的会话撤销流程处理，不对外传递备份包。`docker compose down`保留命名卷；**不要执行 `down -v`**，除非明确要删除全部主题及管理状态。

## 升级与回退

1. 记录当前应用镜像ID/固定标签、配置和完整卷备份。将`.env`中的`LEOBRIDGE_IMAGE`改为已发布的新版本，执行`docker compose pull app`。
2. 新镜像拉取完成后停止旧app，执行`docker compose up -d --no-build`，以同一持久卷单实例启动新镜像。不能仅替换`dist/node.js`而继续使用过期管理资源或依赖。
3. 完成下方验收后保留回退窗口。启动不导入第三方主题，也不更改已有启用版本；在管理站显式审查并切换。
4. 应用回退时停止新容器，恢复先前镜像标签、对应配置，并在状态格式或内容发生变化时恢复同批次完整卷备份。当前没有跨版本状态迁移/降级保证。管理界面的“回退主题”只改当前主题，不能回退应用代码或存储格式。

## 部署检查与排障

- 默认部署检查回环映射端口、`/admin/`登录/改密、数据源保存、重启持久化；指定不同宿主端口时核对站点源和预览链接。
- 自有HTTPS反代检查DNS、证书、同域预览参数、Host/Origin、可信代理及WebSocket；isolated模式还需确认展示和预览不能读取管理接口。
- 检查主题目录读取、安装、预览、启用/回退；真实主题首页、详情、历史及实时逐项验收，不把安装成功当兼容。
- private展示认证应覆盖HTML、资源、HTTP和WS；真实主控Token不出现在浏览器。上游故障显示故障/过期，不伪装全部节点离线。
- 在独立卷演练备份恢复和应用回退，记录版本、环境、失败及未执行项。

连接失败先查看`docker compose ps`及`docker compose logs --tail=100 app`，仅分享脱敏日志。未知Host核对实际访问地址与`BRIDGE_ORIGIN`；proxy模式拒绝请求时核对应用看到的代理来源和转发协议，不关闭来源校验。其他问题见[排障](../troubleshooting.md)。
