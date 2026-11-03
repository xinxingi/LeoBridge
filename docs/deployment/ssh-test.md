# 通过SSH隧道验收测试VPS

此方式用于尚未配置域名/证书的Linux测试服务器。应用在远端容器运行，端口仅监听远端`127.0.0.1`，浏览器通过SSH隧道访问。它不建立公网展示站，也不能替代正式[VPS部署](vps.md)的nginx、DNS和TLS验收。

## 准备

先检查目标系统、CPU架构、已有服务和端口，保留已有应用；准备Docker Engine及Compose v2。内存较小的VPS建议在开发机或CI构建目标架构镜像，使用`docker save`/SSH/`docker load`交付，不需要公开镜像仓库。

Debian13发行版包中daemon、CLI和Compose分别为`docker.io`、`docker-cli`、`docker-compose`。使用`--no-install-recommends`时需显式包含CLI；安装后分别核对`docker --version`、`docker compose version`和daemon状态，不能只凭安装了daemon就判定命令可用。其他发行版按其受支持的Docker安装方式准备，不执行未审查的远程root脚本。

使用`deploy/docker/compose.ssh-test.yaml`。此模板使用Linux host network，让Node的local模式直接绑定宿主回环；没有`ports`映射，没有nginx服务，不能将`BRIDGE_LISTEN_HOST`改为`0.0.0.0`。它与正式proxy模式分开，不降低生产HTTPS/可信反代校验。

在受限目录准备Node dotenv文件，例如`/opt/leobridge-test/runtime.env`，只包含：

- `MMWX_BASE_URL`和`MMWX_PROBE_TOKEN`：授权主控及只读探针密钥。
- `BRIDGE_BINDINGS`和`BRIDGE_PING_TARGETS`：已审查的绑定，保留原稳定ID。
- `BRIDGE_ADMIN_USERNAME`和至少20字符的独立`BRIDGE_ADMIN_PASSWORD`。
- 可选`BRIDGE_TITLE`。不要复制本机开发代理或全部开发配置。

已有完整本地配置时，可运行`node --import tsx scripts/prepare-ssh-test.ts .dev.vars work/private/ssh-test`。该工具仅复制必要的源配置与稳定绑定，生成独立管理密码并私存`runtime.env`，拒绝覆盖已有文件，不连接网络。通过SSH安全传输该文件；从私有文件读取管理密码，不使用服务器root密码。

私有配置文件需允许容器UID1000读取，例如归属`1000:1000`、权限0400；父目录由宿主管理员保护，文件以只读方式挂载。不要为了容器可读而把配置设为所有用户可读，也不要打印文件或把密钥放在命令参数中。

另建不含凭据的Compose变量文件，指定本地镜像标签、私有配置的绝对路径及独立卷名：

```dotenv
LEOBRIDGE_IMAGE=leobridge:vps-test
BRIDGE_PRIVATE_ENV_FILE=/opt/leobridge-test/runtime.env
THEME_STORE_VOLUME=leobridge-ssh-test-store
```

在测试目录执行`docker compose -f compose.ssh-test.yaml config --quiet`及`docker compose -f compose.ssh-test.yaml up -d`。通过`docker compose ... ps`、本机`/healthz`和`ss -ltn`检查启动与回环绑定；不要启用公网防火墙放行来解决隧道问题。

## 访问

在自己的电脑建立隧道，替换已授权SSH账号/主机，不把密码写在命令中：

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18886:127.0.0.1:18886 \
  -L 127.0.0.1:18887:127.0.0.1:18887 \
  -L 127.0.0.1:18889:127.0.0.1:18889 \
  user@your-test-server
```

浏览器打开管理入口`http://vps-admin.localhost:18886`、展示入口`http://vps-monitor.localhost:18887`，预览从管理界面打开。浏览器需支持`*.localhost`；版本URL仍按主机名隔离。关闭SSH连接后本机隧道失效，服务器端应用可继续运行。

需要本机SOCKS代理时，将`ProxyCommand nc -X 5 -x 127.0.0.1:7897 %h %p`放入该测试目标专用SSH配置，并让`ssh`与`scp`都用同一配置；按实际已确认的代理地址调整。不要只给最初登录添加代理、后续传输却回退直连。保留主机密钥校验，不以关闭校验解决网络超时。当前测试的实际结果见[VPS私有测试记录](../research/vps-private-acceptance.md)。

此测试配置为`BRIDGE_ACCESS=local`：浏览器侧只接受localhost源，远程访问由SSH认证和两端回环监听限制；不是生产`private` Basic Auth策略。HTTP仅存在于回环接口及加密SSH隧道两端，不经过公网明文传输。本机其他用户/进程可能访问已建立的隧道，因此仅在受信任的测试电脑使用。独立管理登录依然生效，不复用服务器root密码。

## 验收与后续

区分合成容器测试和授权主控真实数据；记录首页、详情、系统/Ping历史、原生WS/HTTP回退、主题切换、重启持久化、备份恢复及应用回退。恢复/回退使用独立卷并保留原卷；不要让两实例共写状态。

未来迁移正式域名时，保留状态备份并停止本测试实例，审查生产public/private策略、DNS、证书和可信代理配置，再使用正式Compose/nginx模板。仅有SSH隧道通过时，状态写为“VPS私有测试通过，公网DNS/TLS待验收”，不能声称已公开上线。
