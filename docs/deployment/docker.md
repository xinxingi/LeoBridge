# Docker 部署

从Docker Hub拉取已发布的固定版本镜像，用Docker Compose管理。目标机器无需Node、pnpm或源码编译。当前模板包含LeoBridge和nginx，采用独立管理、展示及预览域名，需要准备域名和HTTPS证书；直接使用运行包见[本地部署](local.md)。

**发布状态：目前尚未公开发布Docker Hub镜像，账号/仓库地址将在正式发布时提供。** 不要把示例占位符当作可拉取地址。自行构建镜像统一见[开发文档](../development/build.md)。

## 准备与域名

目标机器需有Docker Engine、Docker Compose v2（建议当前受支持版本），能够访问Docker Hub及授权主控。宿主入口仅发布80/443；按实际流量观察资源占用，当前没有生产容量或高可用承诺。

管理、展示、不可变主题版本、预览必须按主机名隔离。以下是一组完整示例，替换为自己控制的域名：

| 用途 | 配置 | DNS / 证书名称 |
| --- | --- | --- |
| 独立管理站 | `BRIDGE_ADMIN_HOST=admin.example.com` | `admin.example.com` |
| 当前展示入口 | `BRIDGE_DISPLAY_HOST=monitor.example.com` | `monitor.example.com` |
| 不可变版本 | `BRIDGE_DISPLAY_DOMAIN=themes.example.com` | `*.themes.example.com` |
| 预览基源及版本 | `BRIDGE_PREVIEW_HOST=preview.example.com` | `preview.example.com`、`*.preview.example.com` |

分别将这些主机及两个通配 DNS 指向目标机器。实际页面地址形如 `t-<安装ID>.themes.example.com` 和 `p-<安装ID>.preview.example.com`，不能改成仅一个域名下的不同路径。预览基源本身不代表某个已安装页面。

自备包含以上名称的 SAN/通配证书及私钥，放在例如 `/etc/leobridge/tls/fullchain.pem`、`/etc/leobridge/tls/privkey.pem`。`*.example.com` **不能覆盖** `t-<ID>.themes.example.com` 或 `p-<ID>.preview.example.com`；需要各自更深一层的通配名称。通配证书也不覆盖其基域本身。模板使用一份覆盖整组名称的证书；分证书方案需要自行拆分 nginx server 块。

此项目不自动签发或续期证书。使用自己的证书管理工具完成签发/续期，再运行 `docker compose exec nginx nginx -t` 和 `docker compose exec nginx nginx -s reload`。证书目录以只读方式挂载；如文件为其他目录中的符号链接，挂载必须同时覆盖实际目标，或将完整文件安全写入挂载目录。控制私钥访问权限，不提交证书私钥。

## 配置及首次启动

将同版本的compose.yaml、.env.example和nginx.conf.template放在部署目录（模板位于仓库deploy/docker），在该目录操作：

```sh
cd /path/to/leobridge-deploy
cp .env.example .env
chmod 600 .env
# 在私有编辑器中填写 .env，再检查下面各项。
docker compose config --quiet
docker compose pull
docker compose up -d --no-build
docker compose ps
```

启动后打开配置的管理域名（如`https://admin.example.com/`），登录改密、保存数据源，再按[主题管理](../themes.md)安装和启用主题。

不要覆盖已有 `.env`，也不要将 `docker compose config` 的展开配置、`docker inspect` 环境变量或 `.env` 内容贴到工单。容器管理员/Docker 管理员能查看应用环境变量和持久卷；这不是隔离宿主管理员的密钥保险库。

`.env.example`将镜像地址和展示访问策略留空，需要明确填写；主控连接可在启动后的后台填写：

- 将`LEOBRIDGE_IMAGE`设为发布说明中的Docker Hub仓库和固定版本，格式为`docker.io/<账号>/leobridge:<版本>`；也可使用发布的镜像摘要固定内容，不依赖滚动latest标签。Compose只使用image，没有隐式构建步骤。

- 新站点无需设置 `MMWX_BASE_URL` 和 `MMWX_PROBE_TOKEN`。登录管理页、改密后，在“数据源设置”填写主控地址和 Token 并检查连接；Token 仅在服务端保存。环境变量保留为已有部署的兼容方式。
- 显式选择 `BRIDGE_ACCESS=public` 或 `private`。public 公开所选探针数据；private 为展示 HTML、资源、HTTP、WS 增加独立 Basic Auth。private 的 `BRIDGE_USERNAME` 非空、`BRIDGE_PASSWORD` 至少16字符，浏览器可能在不同版本/预览源分别要求认证。
- `BRIDGE_ADMIN_PASSWORD` 可留空，默认初始密码为 `admin`，用户名默认 `admin`；自定义初始口令至少20字符。首次登录必须更换为12–128位且包含大小写字母、数字和符号的强密码。改密结果随状态卷持久化，旧会话全部失效，后续环境变量初始口令不再生效。管理站使用自己的登录会话。
- `BRIDGE_BINDINGS` 是审查后的完整绑定 JSON；`BRIDGE_PING_TARGETS` 是已确认目标键的 JSON。可以将已完成本地配置中的这两项私下迁移，保留原稳定ID。不要复制整个开发配置，也不要把本地开发代理和localhost源带到生产。
- 新站点在后台检查连接、确认节点身份与 Ping 目标后保存，无需先运行本地配置脚本。改名/隐藏/增删节点后仍需要在页面显式核对身份，不能自动按名称或下标映射。
- 值可用单引号包围以保留字面 `$`，JSON不要改成多行 shell 命令；不要将秘密放进命令参数。

Compose 把四个主机名转换为 HTTPS 源。`BRIDGE_NODE_MODE=proxy` 让应用单监听 `0.0.0.0:8787`，端口不映射到宿主。只信任 nginx 的固定 `PROXY_IPV4`，默认 `172.30.84.2/32`；`BACKEND_SUBNET` 默认 `172.30.84.0/24`，`BACKEND_DYNAMIC_RANGE` 默认 `172.30.84.128/25`，将应用动态地址与固定代理地址分开。如与目标网络冲突，启动前同时调整网段、动态地址池及 nginx 地址，确保代理位于子网内且不在动态池中，不要扩大到信任所有代理。Docker bridge 保留出站网络以访问主控/官方主题源，未使用会阻断出站的 `internal: true`。

模板由nginx提供HTTPS/WSS，保留Host及WebSocket升级头。容器nginx通过Docker DNS `127.0.0.11`动态解析应用地址；应用独立重建并换IP后，代理无需重建即可恢复。此DNS地址仅适用于Docker容器网络。nginx 覆盖 `Host`、`X-Forwarded-Proto=https` 和单值 `X-Real-IP`，清除 `Forwarded`、`X-Forwarded-Host` 和 `CF-Connecting-IP`；应用不会因客户自带代理头而信任其源或地址。模板面向 nginx 直接接收客户TLS的部署。若增加 CDN/负载均衡，不要直接信任任意来路的客户端IP头，应先审查完整代理链并重新验收认证限速与来源隔离。

应用容器以 UID/GID1000（`node`）运行、根文件系统只读、去除额外 Linux capabilities，仅持久卷和临时目录可写。镜像只保留生产依赖、`dist/node.js`、`dist/bundled`和包元数据；主题按需安装到状态卷，其许可说明随资源保留。代理模式默认不读开发 `.dev.vars`；Compose 显式传入所需配置，不挂载开发文件。

部署记录保留应用镜像的固定版本及摘要，并记录nginx镜像版本。镜像更新后重新验收，标签存在或拉取成功不等于功能验收通过。

## 状态、备份与恢复

`leobridge-theme-store`命名卷挂载至 `/data/theme-store`，保存完整主题包、安装元数据、active/previous指针、数据源凭据和管理会话。首次空卷启动无主题，显示安装引导；重启保留安装及启用状态。`/healthz`只确认本机进程存活，不读取主控，不证明Token、身份、历史或WebSocket正确；nginx阻止它对公网开放。Compose健康检查失败会标记unhealthy，单靠该标记不会自动修复上游或重新启动仍在运行的进程。

当前文件存储按**单站、单进程、单副本**运行。文件锁/原子替换不等于共享盘分布式事务；不要 `--scale app`、不要让多台VPS/NFS共同写此目录，也不要由滚动更新临时启动第二写入者。主题切换可以在管理站完成；应用二进制升级需要停机窗口。

以下是停止写入后的整卷备份示例，工作目录仍为部署目录：

```sh
docker compose stop nginx app
BACKUP_DIRECTORY="$HOME/leobridge-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIRECTORY"
chmod 700 "$BACKUP_DIRECTORY"
docker compose run --rm --no-deps --user 0 \
  --volume "$BACKUP_DIRECTORY:/backup" --entrypoint sh app \
  -c 'umask 077; tar -C /data/theme-store -czf /backup/theme-store.tgz .'
docker compose up -d
```

备份位于仓库之外，归属root、权限0600；宿主管理员后续加密/转移时应保留受限访问，按时间/版本保存，避免覆盖。单独加密备份 `.env` 和证书私钥；卷备份含管理会话，应按凭据同等级保护。只备份 `state.json`、active指针或镜像不够，必须包含所有 `packages/` 资源。停止后仍有 `state.lock` 时先确认没有其他写入进程，保留原始备份后再按排障文档处理；不可在线删除锁。不能依赖容器内存缓存恢复历史，历史仍在上游。

恢复时先停止应用和代理，将备份解包到一个**新的空命名卷**，恢复UID/GID1000及私有权限，再把`.env`中的`THEME_STORE_VOLUME`改为新卷名后启动。先保留原卷，不向在线卷覆盖解包。验证已安装主题资源、active/previous、管理登录和真实HTTP/WS后才决定清理旧卷。恢复会话会恢复备份时的认证状态，应按自己的会话撤销流程处理，不对外传递备份包。`docker compose down`保留命名卷；**不要执行 `down -v`**，除非明确要删除全部主题及管理状态。

## 升级与回退

1. 记录当前应用镜像ID/固定标签、配置和完整卷备份。将`.env`中的`LEOBRIDGE_IMAGE`改为已发布的新版本，执行`docker compose pull app`。
2. 新镜像拉取完成后停止旧nginx/app，执行`docker compose up -d --no-build`，以同一持久卷单实例启动新镜像。不能仅替换`dist/node.js`而继续使用过期管理资源或依赖。
3. 完成下方验收后保留回退窗口。启动不导入第三方主题，也不更改已有启用版本；在管理站显式审查并切换。
4. 应用回退时停止新容器，恢复先前镜像标签、对应配置，并在状态格式或内容发生变化时恢复同批次完整卷备份。当前没有跨版本状态迁移/降级保证。管理界面的“回退主题”只改当前主题，不能回退应用代码或存储格式。

## 部署检查与排障

- DNS和证书覆盖管理、展示根、任意实际`t-…`版本及`p-…`预览；HTTPS跳转不丢主机，未知主机拒绝，后端8787不能从公网直连。
- 管理登录/退出、Secure/HttpOnly/SameSite及host-only cookie，错误Origin/CSRF拒绝；展示和预览不能读管理接口。
- 当前启用及上一主题持久化，双商店实际目录读取与包安装、隔离预览、启用/回退；不把安装成功当主题兼容。
- CFSM、Komari各自浏览器首页、详情、1h/7d系统/Ping图表、零/缺失显示和实时变化；WSS101、原生上游消息、HTTP回退分别记录，关闭页面释放连接。
- private站点覆盖HTML、资源、HTTP、WS；真实主控Token不出现在浏览器。上游故障显示故障/过期，不伪装全部服务器离线。
- 重启容器后状态、资源和管理流程正常；在隔离卷实际演练备份恢复及应用回退。记录源码、镜像、目标环境、时间、失败及未执行项。

nginx502先查应用健康、网络和镜像完整性；`Bad host`/来源错误核对HTTPS origin、Host和可信代理IP；cookie不生效核对TLS、主机隔离和转发协议，不关闭安全校验。历史请求可耗时接近110秒，模板读超时120秒；不能通过无限延长超时掩盖源端失败。查看`docker compose logs --tail=100 app nginx`前注意日志可能包含请求上下文，仅分享脱敏摘要。身份/历史/主题包故障见[排障](../troubleshooting.md)。

部署后按上述清单检查实际容器、域名、证书、上游和前台；拉取成功或健康检查通过不能代替完整验收。
