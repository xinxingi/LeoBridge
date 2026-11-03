# VPS 部署：Node、Docker Compose 与 nginx

VPS 是当前优先交付的部署方式。本文提供可审查的部署工件。本机Docker/nginx合成验收已通过；用户提供的测试VPS按[SSH私有方式](ssh-test.md)推进，**公网DNS/TLS和生产验收仍待完成**。本地或SSH测试均不等于公开上线。Workers 保留为后续部署选项。

应用以单个 Node 进程运行，nginx 终止 HTTPS/WSS，主题和管理状态保存在持久卷。桥接器继续只读访问已配置的妙妙屋X，历史仍由上游保存；不安装采集 Agent，也不运行 CFSM/Komari 完整后端。当前没有官方预构建公开镜像、自动发布或远程部署流程，镜像由使用者从审查过的检出本地构建。

## 准备与域名

目标机器需有 Docker Engine、Docker Compose v2（建议当前受支持版本）、可访问依赖源和授权主控的出站网络。应用构建使用 Node 24、pnpm 11.25.0 和冻结锁文件。宿主入口仅发布80/443；为容器和构建预留资源并按实际流量观察，当前没有生产容量或高可用承诺。

管理、展示、不可变主题版本、预览必须按主机名隔离。以下是一组完整示例，替换为自己控制的域名：

| 用途 | 配置 | DNS / 证书名称 |
| --- | --- | --- |
| 独立管理站 | `BRIDGE_ADMIN_HOST=admin.example.com` | `admin.example.com` |
| 当前展示入口 | `BRIDGE_DISPLAY_HOST=monitor.example.com` | `monitor.example.com` |
| 不可变版本 | `BRIDGE_DISPLAY_DOMAIN=themes.example.com` | `*.themes.example.com` |
| 预览基源及版本 | `BRIDGE_PREVIEW_HOST=preview.example.com` | `preview.example.com`、`*.preview.example.com` |

分别将这些主机及两个通配 DNS 指向目标 VPS。实际页面地址形如 `t-<安装ID>.themes.example.com` 和 `p-<安装ID>.preview.example.com`，不能改成仅一个域名下的不同路径。预览基源本身不代表某个已安装页面。

自备包含以上名称的 SAN/通配证书及私钥，放在例如 `/etc/leobridge/tls/fullchain.pem`、`/etc/leobridge/tls/privkey.pem`。`*.example.com` **不能覆盖** `t-<ID>.themes.example.com` 或 `p-<ID>.preview.example.com`；需要各自更深一层的通配名称。通配证书也不覆盖其基域本身。模板使用一份覆盖整组名称的证书；分证书方案需要自行拆分 nginx server 块。

此项目不自动签发或续期证书。使用自己的证书管理工具完成签发/续期，再运行 `docker compose exec nginx nginx -t` 和 `docker compose exec nginx nginx -s reload`。证书目录以只读方式挂载；如文件为其他目录中的符号链接，挂载必须同时覆盖实际目标，或将完整文件安全写入挂载目录。控制私钥访问权限，不提交证书私钥。

## 配置及首次启动

以下命令在目标机器上由部署者执行；本文没有替你运行远程部署。

```sh
cd /path/to/LeoBridge/deploy/docker
cp .env.example .env
chmod 600 .env
# 在私有编辑器中填写 .env，再检查下面各项。
docker compose config --quiet
docker compose build --pull app
docker compose up -d
docker compose ps
```

不要覆盖已有 `.env`，也不要将 `docker compose config` 的展开配置、`docker inspect` 环境变量或 `.env` 内容贴到工单。容器管理员/Docker 管理员能查看应用环境变量和持久卷；这不是隔离宿主管理员的密钥保险库。

`.env.example` 故意将必要密钥和访问策略留空，未填写会拒绝启动：

- `MMWX_BASE_URL` 为授权主控的完整源，例如 `https://controller.example`，不带 API 路径、用户名或查询参数。`MMWX_PROBE_TOKEN` 仅服务端使用。
- 显式选择 `BRIDGE_ACCESS=public` 或 `private`。public 公开所选探针数据；private 为展示 HTML、资源、HTTP、WS 增加独立 Basic Auth。private 的 `BRIDGE_USERNAME` 非空、`BRIDGE_PASSWORD` 至少16字符，浏览器可能在不同版本/预览源分别要求认证。
- `BRIDGE_ADMIN_PASSWORD` 使用至少20字符的独立随机口令，与上游Token和展示密码分开。管理站使用自己的登录会话，无法用展示 Basic Auth 替代。
- `BRIDGE_BINDINGS` 是审查后的完整绑定 JSON；`BRIDGE_PING_TARGETS` 是已确认目标键的 JSON。可以将已完成本地配置中的这两项私下迁移，保留原稳定ID。不要复制整个开发配置，也不要把本地开发代理和localhost源带到生产。
- 尚未初始化绑定的新站点，先按仓库 README 的本地只读配置流程取得、审查绑定。`[]` 只是占位，不能为已有服务器提供身份映射；改名/隐藏/增删节点后需要显式维护，不能自动按名称或下标映射。
- 值可用单引号包围以保留字面 `$`，JSON不要改成多行 shell 命令；不要将秘密放进命令参数。

Compose 把四个主机名转换为 HTTPS 源。`BRIDGE_NODE_MODE=proxy` 让应用单监听 `0.0.0.0:8787`，端口不映射到宿主。只信任 nginx 的固定 `PROXY_IPV4`，默认 `172.30.84.2/32`；`BACKEND_SUBNET` 默认 `172.30.84.0/24`，`BACKEND_DYNAMIC_RANGE` 默认 `172.30.84.128/25`，将应用动态地址与固定代理地址分开。如与目标网络冲突，启动前同时调整网段、动态地址池及 nginx 地址，确保代理位于子网内且不在动态池中，不要扩大到信任所有代理。Docker bridge 保留出站网络以访问主控/官方主题源，未使用会阻断出站的 `internal: true`。

容器nginx通过Docker DNS `127.0.0.11`动态解析应用地址；应用独立重建并换IP后，代理无需重建即可恢复。此DNS地址仅适用于Docker容器网络。nginx 覆盖 `Host`、`X-Forwarded-Proto=https` 和单值 `X-Real-IP`，清除 `Forwarded`、`X-Forwarded-Host` 和 `CF-Connecting-IP`；应用不会因客户自带代理头而信任其源或地址。模板面向 nginx 直接接收客户TLS的部署。若增加 CDN/负载均衡，不要直接信任任意来路的客户端IP头，应先审查完整代理链并重新验收认证限速与来源隔离。

应用容器以 UID/GID1000（`node`）运行、根文件系统只读、去除额外 Linux capabilities，仅持久卷和临时目录可写。镜像只保留生产依赖、`dist/node.js`、`dist/bundled`和包元数据；内置主题许可证随资源保留。`.dockerignore`使用白名单，真实 `.dev.vars`、私有响应、Git历史、现有构建、参考源码不进入构建上下文。代理模式默认不读开发 `.dev.vars`；Compose 显式传入所需配置，不挂载开发文件。

默认基础镜像标签固定大版本而非镜像内容摘要。正式发布前可将 `.env` 中 `NODE_IMAGE`/`NGINX_IMAGE`改成已审查的 `tag@sha256:…`，记录源码提交、锁文件、两个基础镜像digest和最终应用image ID，以便复现；不要将“冻结JS依赖”写成基础镜像位级固定。部署后再次构建带来新源码或新基础镜像时，需重新验收。

## 状态、备份与恢复

`leobridge-theme-store`命名卷挂载至 `/data/theme-store`，保存完整主题包、安装元数据、active/previous指针和管理会话。首次空卷启动会种入两套内置包；重启保留安装及启用状态。`/healthz`只确认本机进程存活，不读取主控，不证明Token、身份、历史或WebSocket正确；nginx阻止它对公网开放。Compose健康检查失败会标记unhealthy，单靠该标记不会自动修复上游或重新启动仍在运行的进程。

当前文件存储按**单站、单进程、单副本**运行。文件锁/原子替换不等于共享盘分布式事务；不要 `--scale app`、不要让多台VPS/NFS共同写此目录，也不要由滚动更新临时启动第二写入者。主题切换可以在管理站完成；应用二进制升级需要停机窗口。

以下是停止写入后的整卷备份示例，工作目录仍为 `deploy/docker`：

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

恢复时先停止应用和代理，将备份解包到一个**新的空命名卷**，恢复UID/GID1000及私有权限，再把`.env`中的`THEME_STORE_VOLUME`改为新卷名后启动。先保留原卷，不向在线卷覆盖解包。验证两个主题资源、active/previous、管理登录和真实HTTP/WS后才决定清理旧卷。恢复会话会恢复备份时的认证状态，应按自己的会话撤销流程处理，不对外传递备份包。`docker compose down`保留命名卷；**不要执行 `down -v`**，除非明确要删除全部主题及管理状态。

## 升级与回退

1. 记录当前源码提交、应用镜像ID/固定标签、配置和完整卷备份；将新源码在独立检出中运行 `pnpm check`，构建不同本地镜像标签（修改`.env`中的`LEOBRIDGE_IMAGE`）。当前没有自动推送任何镜像仓库。
2. 新镜像构建完成后停止旧nginx/app，再以同一持久卷单实例启动新镜像。不能仅替换`dist/node.js`而继续使用过期主题构建或依赖。
3. 完成下方验收后保留回退窗口。启动会导入新内置包，但不会将已启用主题自动视为新版本；在管理站显式审查并切换。
4. 应用回退时停止新容器，恢复先前镜像标签、对应配置，并在状态格式或内容发生变化时恢复同批次完整卷备份。当前没有跨版本状态迁移/降级保证。管理界面的“回退主题”只改当前主题，不能回退应用代码或存储格式。

## 非容器备选：systemd

`deploy/systemd/leobridge.service`是简洁单机模板。准备Node24、专用`leobridge`用户、`/opt/leobridge/current`只读发布目录（`dist/node.js`、`dist/bundled`、`package.json`及生产`node_modules`），并确保`/usr/bin/node`为目标Node路径。将私有Node dotenv配置写入`/etc/leobridge/runtime.env`，归属`root:leobridge`、权限0640，父目录仅允许必要访问。该文件包含本节对应的完整HTTPS origin、身份、访问策略和凭据；它不是Docker `.env`主机名插值配置，不能原样复制代替。

服务的`BRIDGE_ENV_FILE`交由Node解析dotenv，环境变量覆盖文件值；不要再用systemd的`EnvironmentFile`重复解析，以免引号/JSON语义不同。状态放`/var/lib/leobridge/theme-store`，systemd创建私有父目录；监听127.0.0.1:8787且只信任本机代理。宿主nginx将模板中的域名替换为字面值，删除Docker专用`resolver 127.0.0.11`及其`upstream`块，`proxy_pass`改为`http://127.0.0.1:8787`，保留TLS和代理头规则。部署者审查路径/用户/配置后安装service并运行`systemctl daemon-reload`及`systemctl enable --now leobridge`。此备选没有在真实systemd主机执行，不记为验收通过。

## 目标VPS验收与排障

- DNS和证书覆盖管理、展示根、任意实际`t-…`版本及`p-…`预览；HTTPS跳转不丢主机，未知主机拒绝，后端8787不能从公网直连。
- 管理登录/退出、Secure/HttpOnly/SameSite及host-only cookie，错误Origin/CSRF拒绝；展示和预览不能读管理接口。
- 当前启用及上一主题持久化，双商店实际目录读取与包安装、隔离预览、启用/回退；不把安装成功当主题兼容。
- CFSM、Komari各自浏览器首页、详情、1h/7d系统/Ping图表、零/缺失显示和实时变化；WSS101、原生上游消息、HTTP回退分别记录，关闭页面释放连接。
- private站点覆盖HTML、资源、HTTP、WS；真实主控Token不出现在浏览器。上游故障显示故障/过期，不伪装全部服务器离线。
- 重启容器后状态、资源和管理流程正常；在隔离卷实际演练备份恢复及应用回退。记录源码、镜像、目标环境、时间、失败及未执行项。

nginx502先查应用健康、网络和构建文件；`Bad host`/来源错误核对HTTPS origin、Host和可信代理IP；cookie不生效核对TLS、主机隔离和转发协议，不关闭安全校验。历史请求可耗时接近110秒，模板读超时120秒；不能通过无限延长超时掩盖源端失败。查看`docker compose logs --tail=100 app nginx`前注意日志可能包含请求上下文，仅分享脱敏摘要。身份/历史/主题包故障见[排障](../troubleshooting.md)。

本机已实际构建arm64及amd64镜像，主代理独立重跑42项容器/nginx检查通过，涵盖HTTPS/WSS、鉴权、历史、应用换IP、持久化及600文件完整恢复，见[容器验收](../research/container-acceptance.md)。脚本使用合成源与临时测试CA，未冒充真实主控或公共证书。systemd、跨应用版本升级回退仍未执行。测试VPS的真实结果见[开发进度](../progress.md)，不由本机通过推定。
