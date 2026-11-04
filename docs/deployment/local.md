# 本地部署（预编译运行包）

普通用户下载对应系统、架构的运行包，解压后直接启停。包内带有Node、应用、生产依赖和管理资源，目标机器无需安装Node、npm或pnpm，也不需要编译。

从[GitHub Release v0.2.0](https://github.com/xinxingi/LeoBridge/releases/tag/v0.2.0)下载Linux运行包及对应`.sha256`附件。不要下载GitHub自动生成的`Source code`源码归档作为运行包。其他版本从[版本列表](https://github.com/xinxingi/LeoBridge/releases)选择；macOS自行构建见[开发文档](../development/build.md)，当前发布流程不生成macOS或Windows运行包。

## 获取和启动

Release附件受GitHub仓库权限控制。私有仓库需先登录有访问权限的账号，匿名访问可能返回404；无需把GitHub凭据配置到LeoBridge中。

先用`uname -m`确认目标机器架构：

| 系统输出 | v0.2.0附件 |
| --- | --- |
| `x86_64` | `leobridge-0.2.0-linux-x64.tar.gz`及同名`.sha256` |
| `aarch64` / `arm64` | `leobridge-0.2.0-linux-arm64.tar.gz`及同名`.sha256` |

Linux官方Node运行时需要glibc；Alpine等环境建议使用[Docker镜像](docker.md)。将运行包和对应校验文件下载到同一目录，以下以x64为例，arm64替换两处包名及目录名：

```sh
sha256sum -c leobridge-0.2.0-linux-x64.tar.gz.sha256
tar -xzf leobridge-0.2.0-linux-x64.tar.gz
cd leobridge-0.2.0-linux-x64
./leobridge.sh start
```

只有摘要校验成功才继续解压启动。用macOS核对Linux包摘要时可用`shasum -a 256 -c`，但Linux包不能在macOS直接运行。

启动只使用包内已有程序，不联网下载运行环境、不安装依赖或构建。缺少文件或运行时不匹配会报错，此时应重新下载完整的匹配包。无参数运行`./leobridge.sh`等同于start；若执行权限未保留，可用`bash leobridge.sh start`。

程序默认后台运行，关闭终端后继续运行，只监听本机`127.0.0.1:8787`。首次启动不需要上游凭据或第三方主题，需要Bash。远程服务器部署时，先通过SSH隧道访问后台，或按下方反代章节配置访问入口；在自己电脑直接打开127.0.0.1不会访问到远端服务。

## 初始化

1. 打开[管理后台](http://127.0.0.1:8787/admin/)。全新状态且未自定义账号时，用`admin` / `admin`登录，设置12–128位、含大小写字母、数字和符号的新密码后重新登录。已有实例使用当前密码。
2. 在“设置 → 数据源”填写妙妙屋X主控地址与Token，检查连接，核对节点身份和最多8个Ping目标后保存。
3. 在CFSM或Komari商店查看来源和许可信息，主动确认安装，预览后启用。
4. 打开[展示首页](http://127.0.0.1:8787/)，检查节点、详情、历史及实时更新。

默认single预览使用同一站点的`?__preview=<安装ID>`，不需要额外子域名。默认同源展示与管理，只应预览和启用可信主题；需要独立源时按[配置参考](../configuration.md)使用isolated模式，本地isolated模式才需要浏览器支持`*.localhost`回环解析。运行包可直接启动，但连接数据源、安装主题及按需加载资源仍需相应网络。

## 后台管理

| 命令 | 行为 |
| --- | --- |
| `./leobridge.sh start` | 后台启动；已运行时不重复创建进程 |
| `./leobridge.sh stop` | 停止本脚本启动的服务；已停止时可重复执行 |
| `./leobridge.sh restart` | 等待旧进程退出，再使用当前配置启动 |
| `./leobridge.sh status` | 查看运行状态、PID、启动时间、管理入口和日志路径 |
| `./leobridge.sh logs` | 输出最近最多100行运行日志（最多读取64KiB） |
| `./leobridge.sh help` | 查看命令帮助 |

静默启动使用`./leobridge.sh start --quiet`；正常输出隐藏，失败仍报告错误。运行日志在`work/local/service.log`，持续查看可用`tail -f work/local/service.log`。启动时日志超过5MiB会保留为`service.log.1`；运行期间不自动轮转，长期运行需管理日志容量。

成功退出码为0，操作失败为1，参数错误为2，status确认未运行时为3。启动成功表示应用全部端口就绪，状态正常不等于上游或主题兼容验收通过。停止先发送SIGTERM，等待最多10秒后终止仍未退出的应用进程。

脚本通过仅监听回环的控制端口和私有令牌管理当前目录实例，不按旧PID记录直接杀进程；状态无法确认时会报错。后台管理进程退出时应用也会退出。系统重启后需重新start，崩溃不会自动拉起；需要开机自启和自动恢复时交给系统服务管理器或使用Docker重启策略。

## 配置与持久化

新用户无需创建`.dev.vars`；主控地址与Token直接在后台填写。日后在后台改密码、保存数据源，均立即生效，不需要restart，也不会修改`.dev.vars`。

`BRIDGE_ADMIN_USERNAME`始终决定用户名；管理密码与数据源只在后台设置，统一保存到状态文件，重启保留。旧初始化变量已移除，迁移见[配置在哪里修改和保存](../configuration.md#配置在哪里修改和保存)。

默认`data`保存全部主题、active/previous、管理密码摘要、会话及数据源凭据。可用`BRIDGE_THEME_STORE`指定独立持久目录。`work/local`仅保存日志和进程控制记录；不要在运行中删除它，也不要把它复制为新实例的控制记录。

脚本始终以解压目录为工作目录。默认local模式读取该目录的私有`.dev.vars`；字段用途和分类可参考[.dev.vars示例](../../.dev.vars.example)，运行包的生效命令使用`./leobridge.sh restart`，无需执行示例中的开发命令。NODE_ENV=production或proxy/direct模式不自动读取`.dev.vars`，需要文件时使用显式`BRIDGE_ENV_FILE`。环境变量优先于文件。端口默认8787，例如在`.dev.vars`写`PORT=8788`后restart生效；已有显式origin或监听配置优先。临时命令`PORT=8788 ./leobridge.sh start`不保存该变量，下次restart需要再次提供，因此长期参数建议保存在私有文件中。

配置文件、状态备份和日志应限制访问，不原样贴到工单。已有后台配置、管理密码和稳定节点ID均随业务状态保留，不随重启重新生成。

启动前可按[配置预检查](../configuration.md#启动前检查新版)验证参数；该命令需包含部署优化的新版运行包。

旧版本使用work/theme-store；升级前按[旧数据目录迁移](../configuration.md#旧数据目录迁移)处理，或显式沿用旧路径，避免生成空状态。

若使用[systemd示例](../../deploy/systemd/leobridge.service)，程序目录为/opt/leobridge/current，配置与数据分别放在该目录的runtime.env和data；先由管理员创建data并将所有权交给leobridge服务账号、权限设为0700。服务使用包内Node，ReadWritePaths只放行该data目录。更换current指向前停机、完整迁移数据，或显式使用固定数据路径并同步ReadWritePaths。

## 备份、升级和回退

1. 下载并核对新版本运行包，解压到新目录，保留旧版本。
2. 在旧目录执行stop，备份完整`data`及私有配置。只备份state.json或程序文件不够，主题资源也必须保留。
3. 将完整业务状态和配置迁移到新目录，或让新包的`BRIDGE_THEME_STORE`指向原独立数据目录的绝对路径。不要复制旧work/local进程记录，不要同时启动两个写入者。
4. 从新目录start，验证管理登录、数据源、主题资源及历史/实时功能，确认正常后再清理旧包。

升级替换整个运行包，包括内置运行时和依赖；不要仅替换一个JS文件。跨版本状态降级尚无保证，应用回退时停止新实例，恢复对应版本完整备份和旧程序。管理界面的主题回退不能替代应用回退。

## 对外访问

应用只负责HTTP监听和持久化，不管理域名、DNS或证书。需要对外访问时，由部署者配置nginx或Caddy提供反向代理、HTTPS及证书续期；DNS在域名服务商处配置。默认single模式的展示、后台和预览只需同一个域名、同一个反代端口，配置示例见[单域名反代](reverse-proxy.md)。

按[Node运行参数](../configuration.md#node运行参数)设置访问源及展示策略；默认HTTP监听可接入HTTPS反代，无需设置proxy或可信代理地址。连接、身份及图表问题见[排障指南](../troubleshooting.md)。
