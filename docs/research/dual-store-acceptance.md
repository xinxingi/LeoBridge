# 双生态主题管理验收

日期：2026-11-02（Asia/Shanghai）。本文件记录继CFSM阶段之后的实际双商店交付。Cloudflare未部署；合成、真实主控及浏览器证据分别记录，不互相替代。

## 已实现边界

- 两个独立官方目录解析器。刷新时解析官方main提交，再读取固定SHA的JSON；安装传入所见catalogRevision。CFSM构建分支在安装时固定commit，Komari按目录ZIP摘要固定版本。
- 静态包安装校验来源、每次重定向、许可证、文件数量/大小、ZIP路径/符号链接/CRC/膨胀、入口和引用；不执行安装脚本。发现、通过安装校验、已实测兼容分开记录。
- 独立管理源登录、Host-only HttpOnly会话、Origin及CSRF校验、退出撤销；第三方脚本不进入管理源。
- Node持久文件和锁实现安装发布与generation比较；Workers使用R2保存不可变包、单站Durable Object保存元数据及会话。包上传完整后才发布安装记录，活动指针切换与回退原子执行。
- 每个安装独立展示hostname，绑定同一包和protocolProfile。预览使用另一个hostname空间；切换不要求改代码或重部署，旧页面保留原资源和协议。不同端口本身不被视为Cookie隔离。
- 中立Series历史层供CFSM与Komari分别序列化。Komari真实主题使用RPC2 HTTP/WS，没有把CFSM JSON改路径冒充兼容。

## 管理界面实际操作

在独立IAB打开`admin.localhost:8786`，使用本次临时本机验收凭据登录；正式本机管理凭据由`configure:admin`私存`.dev.vars`。

1. Komari商店显示64个官方目录条目，CFSM商店显示12个条目。
2. 点击安装官方AdhesiveNote 1.0.0 ZIP成功，记录原包SHA-256、MIT和283文件；安装保持未验证兼容，未自动启用。
3. 点击安装CFSM Emerald成功，固定构建commit `0939eb9d6e7638ea301f9dd18a218eedba2420c2`、MIT、29文件。该构建无LICENSE，采用严格匹配该build的源码tag许可证证据，不泛用商店MIT。
4. 预览已适配的Adhesive Note，启用后根入口从CFSM跳转到Komari的不可变版本hostname。
5. 保留的CFSM旧页面继续正常显示并更新；回退按钮恢复CFSM根入口，保留的Komari旧页面也继续显示和更新。没有把正在打开的连接改成另一生态schema。
6. 重启后4个安装记录、generation=6及会话仍存在，两内置包显示实测兼容；使用最终revision参数再次安装官方Adhesive Note，界面确认安装完成并返回同一`47fd303d14818b6f6833ab3218c5858d`，未改活动主题。

安装的官方原包与仓库适配构建是不同摘要、不同安装记录。真实兼容结论仅覆盖经过适配并验收的内置包，不自动授予商店原包或其他主题。

## 实际Komari主题

Adhesive Note v1.0.0，MIT，源码commit `8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914`。原布局、手绘素材、字体和图表保留，必要补丁见`web/themes/komari/PATCHES.md`。本轮浏览器使用适配包`89f37d966bcea82777c126e00cbc0313`。

- 真实首页11台、卡片/图标/单位正确；详情实时CPU/网络数值变化，未知流量和未支持能力显示“—”。
- 1h及7d系统历史实际渲染；CPU/内存/磁盘/网速曲线与空缺保留。缺少源采样的负载图保持空白。
- 7d Ping和源桶丢包率曲线实际渲染，时间范围反映已有样本，不补造完整七天。
- 最终浏览器应用error日志为空。
- 合成首页2在线/1离线，近期last_seen没有覆盖offline；缺省CPU/容量/速度为“—”，实际0内存和0上行保留。合成样本不作为真实接口证据。

真实RPC脚本结果：`work/private/komari-acceptance/2026-11-02T13-41-03-147Z/`，11节点；1h系统12点、Ping96点/8目标；7d系统54点/106小时、Ping424点/104小时。WS初轮包含原生与HTTP回退；随后`2026-11-02T13-42-53-845Z/`专门复核10.006秒内3个不同原生观察、0回退、真实指标变化、正常关闭1000。重启进程窗口中的连接拒绝及首次验收脚本主动terminate的1006保留，不归因为上游异常。

## CFSM回归

保留固定默认前台来源和已通过的首页/详情/1h/6h/7d/实时证据。本轮跨生态切换时旧CFSM页仍更新，详情和7d再次实际检查；中立历史提取后的原CFSM转换、身份及故障回归保留。

## Workers与检查

Workers本地模拟已初始化两套599项资源，根入口307返回正确固定版本源。发现并修复跨请求复用DO stub导致的管理登录500，并增加回归。修复后完整运行通过：管理鉴权、CSRF/Origin、generation冲突、Komari切换、R2非零offset资源SHA-256一致、1h/7d系统与Ping、3次原生合成WS观察且数值变化/关闭1000、旧CFSM协议、回退及退出撤销。私有证据`work/private/worker-themes/2026-11-02T14-03-46-555Z/`，详见[运行时验收](theme-runtime-acceptance.md)。失败及修复证据保留，不能写成网络超时。

最终`pnpm check`通过：两项目类型检查、143项自动化测试、两前台/Node/Worker构建。固定锁文件离线安装通过；最终Worker dry-run为333.72 KiB/gzip 81.37 KiB，没有上传。对784个Git候选文件扫描真实源URL/主机、Token、管理/展示密码及私有绑定名称，0命中。GitHub托管CI未执行。真实Cloudflare网络、域名/TLS、资源额度与云端行为未执行，**待部署验收**。本轮未改主控配置、服务器排序、密钥或服务状态，未推送代码、创建云资源或上线。

## 仍保留的能力限制

主题自定义配置UI尚不提供；managed使用默认值，raw/redirect配置不在可信后台运行。目录刷新不保证所有条目可安装或可兼容；缺许可、外部执行依赖、特殊包格式或不支持协议会明确失败。第三方主题只能取得展示站授权的数据，不能取得主控Token或管理会话。云端需要独立管理域及通配展示/预览域和R2/DO授权，详见部署清单。

## 收尾并发失败、修复与复验

`work/private/bridge-acceptance/2026-11-02T14-14-29-571Z/` 真实检查暴露：config/list/detail正常，1h和7d历史都503 `UPSTREAM_SUPERSEDED`。原因是单访客上游WS运输层断线也调用共享Upstream.invalidate，使其他协议正在读取的HTTP快照失效；不是源端确认不支持历史。

修复将运输层断线/握手错误/过期与源payload拒绝分开。运输层只对本连接报告故障并重连，保留有期限且不重标时间的共享观察；无效JSON、探针关闭和身份错误仍清空缓存，名称隐藏的新观察仍覆盖迟到HTTP。新增`tests/realtime-shared.test.ts`的24项跨协议回归，覆盖四类运输故障、pending历史/HTTP、缓存、隐私和身份失效；由主代理读代码并运行全量检查。

保留多个真实浏览器页，并同时运行两个协议脚本，最终结果：

- CFSM `bridge-acceptance/2026-11-02T14-24-56-245Z/`：config/list/detail/1h/7d均200；1h12行，7d84合并行（系统55有效行、Ping54有效行）。WS90秒取得15个真实poll批次及指标变化，0原生批次；因此只记下游/HTTP回退通过。
- Komari `komari-acceptance/2026-11-02T14-24-56-796Z/`：11节点；1h系统12点/Ping96点，7d系统55点/108小时，Ping432点/8目标/106小时。WS13次响应，2次原生观察、11次poll，真实数值变化，正常close1000（60.013秒）。
- CFSM WS单独复核 `bridge-acceptance/2026-11-02T14-27-17-039Z/`：仍为90秒15个poll批次、0原生。其间直接限时只读源WS诊断返回HTTP503，具体原因未确认，不能归因为鉴权或连接数限制。

CFSM脚本的`pass`检查下游消息和结构，原生证据另有`upstream_native_ws_continuity_passed`字段；不能只看总通过字段。这两个CFSM窗口原生检查未通过，达到采样截止后客户端主动terminate，也不记作正常close1000。此前CFSM已有2个原生变化批次的成功证据、Komari本轮也有原生连续观察，但不能据此宣称源端长期稳定或所有并发连接都可用。

修复后实际浏览器CFSM和Komari详情观察时间/CPU/网络指标继续变化，7d选择可用。此前系统/Ping图表截图和无error日志已经实际检查；最后一轮工具的截图/日志/关闭API不可用，保留该工具限制，不声称新增截图证据或成功关闭对应页。

最终本地workerd再次完整通过：`worker-themes/2026-11-02T14-34-14-368Z/`，管理/CSRF/Origin/冲突、R2资源、历史、切换/回退/注销均通过；3次原生合成观察、变化指标、close1000（10.008秒）。仍为本机模拟，不是云部署。

清理合成服务时曾出现重复关闭undici的退出异常，随后Node退出改为幂等。独立合成实例启动三个监听后连续发送SIGINT/SIGTERM，退出0、stderr为空；证据`work/private/shutdown-check/result.json`。独立workerd合成配置生成器及`--check`通过，未把生成文件等同于新目录端到端启动通过。

独立启动复现：主代理按新生成目录启动纯合成上游及全新workerd本地state，`worker-themes/2026-11-02T14-40-38-731Z`共29项检查全部通过，原生合成WS3次/close1000。该结果补齐了生成器文档启动路径的实际验证。
