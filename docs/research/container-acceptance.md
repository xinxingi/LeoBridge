# 本机容器与 nginx 验收

日期：2026-11-03。范围为本机 Docker Engine、独立 Compose 项目、合成妙妙屋X源，以及使用临时自签SAN证书的 nginx HTTPS/WSS。**没有访问真实主控、连接测试VPS、签发公共证书或推送镜像。** 这里验证真实内置主题的资源与接口，不代替浏览器渲染验收或真实VPS验收。

## 可重复执行

```sh
docker build -f deploy/docker/Dockerfile -t leobridge:acceptance .
node scripts/verify-container.mjs
```

需要本机Docker daemon、Node与仓库依赖、OpenSSL。脚本只接受Unix socket本机Docker context；不读取`.dev.vars`。它从现有`deploy/docker/compose.yaml`解析合成变量，然后在独立私有文件中覆写项目名、端口和存储名；应用及nginx镜像、生产配置、TLS模板、可信代理策略保持实际工件。两个公开端口只绑定127.0.0.1的随机空闲高端口，合成上游不映射宿主端口。测试网络使用`172.30.184.0/24`，动态池为`172.30.184.128/25`、nginx为`.2`；若已有网络冲突，脚本会失败，不重配已有网络。不要并发运行同一验收脚本。

每轮在`work/private/docker-acceptance/<UTC>/`保留`summary.json`、`commands.json`、合成配置、临时证书和整卷备份。该目录受Git忽略，文件权限受umask077保护；日志包含测试会话和合成凭据，仍不应公开。脚本结束清理仅带本轮独立名称的容器、卷及网络，保留本地镜像。异常强制终止时，可依据该轮`compose.json`和独立project名清理，禁止使用全局`docker system prune`。

需要amd64镜像时：

```sh
docker build --platform linux/amd64 -f deploy/docker/Dockerfile -t leobridge:vps-test-amd64 .
node scripts/verify-container.mjs --amd64
```

在arm64主机上执行第二条需要Docker已具备架构仿真能力；脚本不安装或改动全局仿真器。镜像只在本机保存，不执行push。

## 实际发现与结果

首次native构建通过，Node24 Debian slim、pnpm11.25.0冻结锁文件、两主题构建及生产依赖裁剪均实际执行。arm64镜像`leobridge:acceptance`的ID为`sha256:2b00381218a65fe20f759e680bc89233f34fac07e6df8b2d527e859188430235`，Docker报告大小449,683,141字节；该数字不是压缩传输大小。

最初沙箱普通命令无法访问Docker socket/预约回环端口，使用已授权的本机验收执行权限后运行。首次完整启动失败记录为`2026-11-03T02-15-00-906Z`：应用健康检查已通过，nginx启动报`Address already in use`。原因是Docker动态分配先占用nginx预设的`.2`；这也可能影响原生产Compose。修复是在`compose.yaml`加入独立`BACKEND_DYNAMIC_RANGE`，默认`172.30.84.128/25`，与固定代理`172.30.84.2`分开。自定义网段必须同时核对动态池及固定代理地址，不能只改subnet。

修复后第一轮全链通过：`2026-11-03T02-16-14-402Z`。扩充检查后的native最终证据为`2026-11-03T02-18-30-529Z/summary.json`，39项检查全部通过：

- nginx配置语法检查、HTTP308转HTTPS、严格校验临时SAN证书（显式测试CA，未关闭证书验证）。
- 应用UID非0、rootfs只读且实际写入失败、后端无宿主端口、`/healthz`未公开。
- 两套实际内置HTML/JS资源均可访问，JS完整SHA-256与镜像内资产一致；无需宿主预先构建dist。
- private策略覆盖根页、HTML、资源、API和WSS；无凭据WS拒绝。CFSM与Komari各自WSS101，收到至少两次不同原生合成CPU观察，不能由HTTP轮询冒充。
- 三台合成节点；CFSM1h/168h历史、Komari1h/168h系统与Ping均检查。每档只有3个系统点、2个有效Ping点；零值保留，一个缺失Ping桶未填0。未把请求七天当作实际完整七天数据。
- 管理cookie具有`__Host-`、Secure、HttpOnly、SameSite=Strict且无Domain；未登录401、外部Origin写入拒绝，预览不能访问管理接口。
- 切换Komari后重启app/nginx，管理会话与启用指针保留；停写整卷备份到私有文件，解包到新卷，使用此前记录的镜像ID重新启动，状态与主题资源可用。
- 从恢复状态执行主题回退到CFSM，旧Komari版本保留原协议，退出会话后401。
- 所有本轮容器、原卷/恢复卷及网络均已清理；本地镜像保留。

随后以`--platform linux/amd64`实际构建`leobridge:vps-test-amd64`成功，镜像ID为`sha256:8aca6342511914e5adad09e4a643bc1aaa7ad20d35b06ecd2a6d907b006f4e63`。在本机arm64 Docker已有仿真能力下运行`node scripts/verify-container.mjs --amd64`，`2026-11-03T02-22-06-193Z/summary.json`同样39项全部通过，测试容器/卷/网络已清理。该轮运行前Docker报告镜像Size为99,332,213字节；不同架构已解包状态的统计可能不同，不应直接与native镜像做实际传输/空间比较，归档大小应以`docker save`结果为准。两个标签均只保留本地，没有push。

审核后补充整卷逐文件验证，`2026-11-03T02-25-20-431Z`通过：停写备份前及新卷恢复后600个文件的相对路径、字节长度和SHA-256完全一致，包含`state.json`及两套主题所有资源，不只检查HTML。对应`backup-manifest.json`与`restored-manifest.json`保留在私有证据目录。

另一项真实失败为`2026-11-03T02-26-48-881Z`：原nginx静态`proxy_pass http://app:8787`只在启动时解析，应用容器单独替换为新IP后，保持nginx不重启会持续502；15.254秒观察未恢复。脚本通过占用本任务旧IP的临时容器强制新app取得不同IP，避免偶然复用旧地址使缺陷漏测。修复为Docker DNS `127.0.0.11`、2秒有效期、共享upstream zone及`server app:8787 resolve`，要求nginx至少1.27.3；当前固定1.28镜像实际支持。宿主systemd部署不使用此Docker DNS段。

最终增强amd64证据：`2026-11-03T02-27-53-188Z/summary.json`，42项全部通过，包含Linux/amd64硬断言、600文件完整恢复比对、应用IP变化但nginx实例及启动时间保持不变后的成功恢复。`recovery_ms=33`只计算新app健康就绪后首次验证所需时间，不是更换容器的总停机时间或服务SLA。最终summary明确`image_upgrade_executed:false`、`image_rollback_executed:false`；镜像tag/ID未变。所有测试专属容器（含临时IP占位者）、卷和网络已清理。

主代理审阅实现及失败证据后独立执行`node scripts/verify-container.mjs --amd64`，`2026-11-03T02-30-35-101Z/summary.json`同一42项全部通过；不是仅依据子任务报告确认。测试资源已清理。

## 验收边界

备份恢复验证了完整主题资源、状态和会话的恢复，并确实以固定镜像ID启动；本次前后使用相同应用代码，**没有证明跨应用版本的状态迁移或降级兼容**。管理界面的主题回退已实际执行，与应用二进制升级回退不同。

当前记录不证明公网DNS、公共CA证书、生产代理链、真实主控网络、长期稳定或并发容量。测试仅使用少量合成数据，且真实浏览器渲染仍由独立验收记录说明。本机amd64仿真通过不能代替目标x86_64 VPS环境验收。
