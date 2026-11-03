# VPS私有测试记录

日期：2026-11-03。用户提供测试VPS并选择仅SSH隧道私有测试，明确SSH必须经过本机代理。**私有实例已运行，接口及运维检查通过；浏览器受权限门禁阻塞，整体验收未完成。** 本文不记录服务器IP、root密码、上游Token或管理密码，未开放公网展示。

## 环境与镜像

目标初始状态为Debian13、Linux x86_64、约1GB内存、约98GB根磁盘，仅SSH监听，没有已有LeoBridge。安装发行版Docker daemon/CLI26.1.5及Compose2.26.1；没有重启整机或修改主控。Debian13的Compose包名为`docker-compose`，最初`docker-compose-v2`不存在；使用`--no-install-recommends`还需显式安装`docker-cli`，最终三项版本均实际确认。

本机Linux/amd64镜像已通过42项容器/nginx合成验收，主代理独立重跑证据为`docker-acceptance/2026-11-03T02-30-35-101Z`，见[容器记录](container-acceptance.md)。本地归档约94MiB，SHA-256为`bf1201400b2f85c78c587dcd5583af0353d23d4f1c370e7e082a5e2f4fb7396f`；在远端完整验证后才执行`docker load`。

本机Docker29显示的镜像标识为`sha256:8aca6342511914e5adad09e4a643bc1aaa7ad20d35b06ecd2a6d907b006f4e63`。归档`manifest.json`引用的配置文件SHA-256为`84da5981b3a4ce921e331af100805c28854dcd0dd8760b8b5b51a8e9c30a3e16`，与远端Docker26加载后的Image ID一致，平台为linux/amd64。核对了完整归档及其配置摘要，没有将两种存储表示的标识差异直接视为内容变化或跳过检查。

## 运行与访问边界

使用`deploy/docker/compose.ssh-test.yaml`：Linux host network、Node local模式、非root用户、只读rootfs、独立私有卷。`ss -ltn`实际确认18886/18887/18889只绑定127.0.0.1，未发布应用公网端口。三个本机回环隧道经同一SOCKS5代理SSH连接访问；没有用本机HTTP代理地址配置远端上游。

`prepare-ssh-test.ts`只复制必要源配置和原稳定ID，生成独立管理密码，拒绝覆盖。实际生成/拒绝覆盖及类型检查通过；原`.dev.vars`和已有输出均保持。远端运行配置UID/GID1000、权限0400、只读挂载，Compose配置实际校验通过；root密码未保存到该文件或仓库。

该环境使用`BRIDGE_ACCESS=local`，访问边界是SSH认证、两端回环和localhost源；独立管理认证仍有效。它不是生产`private` Basic Auth模式，后者已由本机nginx合成环境验收。一次容器采样内存约57.14MiB，不能作为并发容量或长期稳定保证。

## 真实接口与实时

主代理通过隧道运行仓库中的只读验收脚本；原始数据只保存在忽略目录，日志仅输出结构化统计。

| 检查 | 实际结果 |
| --- | --- |
| CFSM配置/列表/详情 | 固定安装路由、字段及11台服务器检查通过 |
| CFSM1h | 12个系统有效行及12个Ping有效行，约55分钟 |
| CFSM7d | 返回84个源时间桶，只有61个系统有效行及60个Ping有效行；不将空桶算有效七天采样 |
| CFSM实时 | 初始11秒窗口有2批原生消息，指标摘要未变；改进验收脚本继续有界观察，补充16.206秒窗口3批原生消息、0批poll且指标确实变化，关闭1000 |
| Komari1h | 系统12点；Ping96点、8目标，约55分钟 |
| Komari7d | 系统61点覆盖120小时；Ping480点、8目标覆盖118小时，不补齐七天 |
| Komari实时 | 16.001秒内2次原生观察及2次真实HTTP回退响应，指标变化，关闭1000 |

CFSM完整证据`bridge-acceptance/2026-11-03T03-11-13-831Z`，补充实时`bridge-acceptance/2026-11-03T03-14-45-586Z`；Komari为`komari-acceptance/2026-11-03T03-11-14-962Z`。以上目录均位于`work/private/`。三个脚本进程退出码0，未修改上游配置、密钥、服务器顺序或采集行为。

`verify-live.ts`现在等到两次原生消息及指标变化后才提前结束，最大观察窗口仍为90秒。合法的相同指标值不伪装变化，原生消息、回退和内容变化仍分别输出。

## 重启、备份与恢复

1. 管理登录后启用Komari，重启实际VPS容器；active、previous、generation保持一致，管理可再次登录并正常退出。
2. 停止应用写入，备份完整原卷到受限目录，在新的空卷恢复；恢复前后600个文件逐路径、字节长度和SHA-256完全一致，包含两套全部资源和state。
3. 使用同一已验证应用镜像启动恢复卷；active、previous、generation仍一致。原卷保留，没有让两个应用并发写状态。
4. 实际调用主题回退到CFSM，旧Komari版本仍保留协议。恢复后的12项复查通过：两套HTML与JS摘要、真实节点API、根跳转、管理未登录401、预览版本/管理隔离及未知Host拒绝。

服务器工作目录`/opt/leobridge-test`，当前卷`leobridge-ssh-test-restored-20261103`，原卷`leobridge-ssh-test-store`保留；备份在`/opt/leobridge-test/backups/20261103`，包含整卷和前后清单。恢复卷由测试命令先创建，Compose曾提示其不是由Compose创建；实际恢复及健康检查通过，该提示没有被计为失败或省略操作。

本机结构证据在`work/private/vps-test/`：`activate-komari.json`、`after-restart.json`、`restore-result.log`、`after-restore.json`、`rollback-cfsm.json`、`post-restore-summary.json`。恢复后首次HTTP复查遇到ECONNRESET，未形成通过记录；应用健康、重启计数0，加入逐项记录后12项完整复跑通过，未确认该次连接重置根因。

本次是同一应用镜像的完整状态恢复和主题回退，**没有执行跨应用版本升级、状态迁移或二进制降级**。

## 失败、权限与未完成项

早期SSH/文件传输出现停滞；后续所有SSH/SCP明确共享本机7897 SOCKS5配置，固定主机密钥校验，禁止复用失效后回退直连。用户切换代理节点后完整镜像上传成功。临时排查客户端容器已清理；没有修改Mac或VPS全局网络设置，也没有擅自改动用户代理规则。

浏览器先后拒绝根入口及固定CFSM版本子域；即使用户在聊天中授权并说明解除设置，工具仍报告已保存拒绝或权限门禁拒绝。已停止重试，未通过替换浏览器、地址绕行或底层自动化规避。**本轮没有成功打开目标VPS前台、截图或验收图表/刷新**；此前本地真实前台验收继续保留，但不能替代此目标环境。

仍待：解除应用侧根入口及实际版本/预览子域的浏览器权限后，验证两套首页、详情、系统/Ping图表和实时；公网DNS/公共CA证书、systemd、跨应用版本升级/回退、GitHub托管CI和Cloudflare部署均未执行。流程见[SSH测试指南](../deployment/ssh-test.md)，公开部署另按[VPS指南](../deployment/vps.md)审查。
