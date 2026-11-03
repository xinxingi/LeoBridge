# 妙妙屋 X 原生主题

2026-11-03核对 [mmwx-group/mmwx-probe](https://github.com/mmwx-group/mmwx-probe)，固定提交 `723427b18ea23a59a923a89155ebe1f3fa3fa824`。它是妙妙屋 X 原生探针前台，独立于CFSM和Komari。后台「原生主题」使用同一套查看安装、知情确认、预览、启用及回退流程；展示协议为`mmwx-native-v1`。本次为尚未发布的源码改动，不包含在现有v0.2.0发行产物中。

## 源码与获取

核对时仓库只有main分支、没有Release或预构建分支，CI仅检查类型及构建，不上传前台工件。不能把源码index.html当成可安装静态入口。README描述Pixel、Flat、Anime；固定App.tsx还包含`appearance.theme === "premium"`分支，实际覆盖Premium。主题和深浅色默认跟随主控appearance，浏览器仍保留上游提供的深浅色选择。LeoBridge不强制改变主控选择或许可标记。

Node首次准备时按固定Git blob索引下载前台源码和锁文件，使用随桥接器提供的npm与esbuild生成静态页面。不会执行上游Worker、部署脚本、npm生命周期脚本或Vite配置。npm依赖必须来自锁文件固定的registry.npmjs.org tarball并含SHA-512 integrity；通过只允许这些URL的临时回环下载入口转交商店传输，沿用代理且失败不直连。不读取用户npm凭据或全局配置。依赖安装限时4分钟，单包80MB、总下载300MB；源码下载并发6。需要临时磁盘及构建内存，失败后可重试。

仅管理界面随产品构建；不内置原生第三方代码或资源字节。准备完成的包在本进程内缓存，再确认时核对同一摘要；重启后按同一来源重建并比较摘要。静态生成文件与许可证写入既有主题存储，公共图片/字体按固定blob校验并按需获取。安装后展示不需要编译。npm及esbuild是Node生产依赖，普通运行包无需系统安装这些工具；Worker尚不支持源码准备。

7份选定参考原文件保存在[参考目录](../references/upstream/mmwx-probe-source/README.md)，不是可执行副本；另只读核对App.tsx、PremiumProbePage.tsx、styles.css及Worker/构建配置（这些文件不保存进项目），URL、Git blob及SHA-256见[独立清单](../references/mmwx-probe-manifest.json)。资源索引`src/themes/native-source.ts`只保存路径、blob摘要和长度，不保存第三方资源内容。原生主题的MSAL-1.0原文及依赖许可继续展示，不把LeoBridge MIT套用给它。

## 原生数据访问

| 浏览器路径 | 固定上游路径 | 行为 |
| --- | --- | --- |
| `/api/probe` | `/api/public/probe-servers` | 原生字段、单位及公开开关，按绑定顺序输出服务器 |
| `/api/series` | `/api/public/probe-series` | 保留系统稀疏点、原生Ping桶及时间；页面槽位解析为本次上游下标 |
| `/api/stream` | `/api/public/probe-ws` | 无订阅消息，完整原生快照；不混入CFSM批次或Komari RPC |
| `/api/forward` | `/api/public/probe-forward` | 只读链路展示，独立接口返回`chains`，快照内使用`forward` |

Token只在服务端请求头中使用，不向浏览器提供上游鉴权。原生协议保留已审计公开字段，不将任意raw对象整体序列化；名称隐藏时不输出节点名或包含名称的转发链。保留费用、流量及其scope、appearance、license_badge等原生含义，不将计费流量变成CFSM/Komari累计指标，不编造缺失字段。源码中的Passkey登录代理和`/login`主控跳转没有接入：LeoBridge仍只提供展示服务。

原生详情路径`#/server/<index>`和历史参数使用数组下标。该值在LeoBridge中只代表显式绑定列表的展示槽位；每次根据稳定绑定重新解析上游下标，普通源端重排不改变页面节点。历史请求前后核对整组源端身份顺序，变化或歧义失败。绑定配置发生变动后应重新打开页面；源端在请求中重排又复原的ABA限制仍存在，不声称拥有上游原子身份保证。

原生历史支持前端提供的1h/6h/24h及2d–7d参数，并检查history_days及返回桶宽；只支持不代表每档已在线验收。系统点和Ping负值保留，不插值、不补零。原生前台即使WS成功也每5秒HTTP轮询；服务端WS有退避、45秒无帧重连、10分钟更新及关闭清理。错误时不发送伪快照，原前台可能继续保留上次成功数据，这一限制需单独记录。

## 验收状态

安装成功不改变`unverified`状态。构建、合成边界、真实浏览器和部署环境结果分别记录，完整兼容只以实际固定前台验收为准。参见[兼容清单](compatibility.md)。


## 本轮实际检查

- 完整工程检查：架构49模块、类型、258项测试与Node构建通过；构建后Node运行时3项通过。独立Worker仅本地打包通过，没有引入上游Worker或执行云端部署。
- 管理UI实际完成原生准备、许可资料展示、确认安装、预览与启用；再切换到独立复制的Komari安装、回退原生。原生根入口WS在切换时关闭，版本预览继续独立绑定。未修改用户原实例状态。
- 真实源11台节点首页及实时数据正常；原生数据记录3帧，其中2批内容不同。系统7d返回7200秒桶、65/66个实际点；Ping7d返回9目标各84桶。浏览器实际看到资源历史及Ping曲线；一次7d Ping浏览器请求HTTP504，仍显示之前1h曲线，因此只记7d Ping接口通过，不记7d Ping浏览器通过。取消未完成请求时原主题有未处理AbortError。
- 合成数据实际打开Pixel、Flat、Anime、Premium；真零、离线及缺值节点可渲染，Premium详情和7d资源控件正常。Premium缺失网速/计费用量在部分摘要中显示0，详情部分位置显示“—”；保留原主题语义，没有据此声明全部缺值边界兼容。名称隐藏、禁用、身份重排、HTTP故障及WS关闭以自动化测试覆盖，没有通过修改真实主控制造。
- 首次编译因绝对公共资源路径未外置失败，修复构建规则。第一次可安装构建出现React #130白屏，核实动画库的UMD/ESM入口选择后，构建器改为优先ESM；不修改上游组件。最终macOS固定源码包摘要为`85f7f5bb268b5be33d338224851f5ac17d1c81e50ca0d106a0fb9b14ca54db78`，111个本地文件、3695个固定公共资源索引。平台依赖许可清单可能不同，跨平台摘要不要求相同；每次确认核对该实例自身准备的摘要。
- 实际macOS arm64运行包在仓库外解包，用包内Node/依赖通过npm版本、esbuild编译、进程健康、初始化及退出检查，无stderr。过程中修复npm别名及扁平内置依赖打包；合成回归覆盖这些布局。不是Linux/VPS/Docker部署验收，也没有发布此macOS测试包。

日志、构建摘要、独立测试状态与截图保存于忽略目录`work/native-theme/`。新安装仍为unverified。未执行真实主控Passkey、转发链完整业务、每个历史档位、四种外观各自全部真实边界、Linux/VPS/Docker或云端部署；没有提交、推送或发布。用户原进程未重启，需在加载新版代码后使用新增入口。

收尾：frozen-lockfile离线安装、管理JS语法及git diff --check通过；测试进程正常退出，18880–18883端口均关闭，临时浏览器已清理。没有重启用户原服务。
