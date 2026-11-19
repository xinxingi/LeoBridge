# 妙妙屋 X 原生主题

官方来源为[mmwx-group/mmwx-probe](https://github.com/mmwx-group/mmwx-probe)，协议为`mmwx-native-v1`。原生商店将上游main解析为固定提交后构建安装，使用统一的确认、预览、启用与回退流程。社区来源见[Jiwo](jiwo-native.md)。

## 源码与获取

原生来源提供源码，Node在安装准备阶段生成静态包。外观默认跟随主控，也可按安装版本保存默认值。可选项从已安装CSS和JS中发现，不使用固定四项列表；识别不完整时可填写上游支持的自定义标识，填写名称不会生成缺少的样式。

HTTP和WS仅覆盖`appearance.theme`，保留`color_mode`、`revision`和`license_badge`。访客在前台保存的手动选择可能优先于后台默认外观，详见[外观优先级](jiwo-native.md#外观优先级)。

原生目录刷新/检查更新将官方main解析成固定提交。Node准备时动态读取该提交的完整Git树，核对路径、文件类型、blob摘要、大小和入口，再下载前台源码和锁文件，使用随桥接器提供的npm与esbuild生成静态页面。目录最多20,000项、所选源码与公共资源总量最多100MB、单文件最多8MB；截断树、符号链接、子模块、歧义路径和缺入口明确失败。不会执行上游Worker、部署脚本、npm生命周期脚本或Vite配置。npm依赖必须来自锁文件固定的registry.npmjs.org tarball并含SHA-512 integrity；通过只允许这些URL的临时回环下载入口转交商店传输，沿用代理且失败不直连。不读取用户npm凭据或全局配置。依赖安装限时4分钟，单包80MB、总下载300MB；源码下载并发6。需要临时磁盘及构建内存，失败后可重试。

仅管理界面随产品构建；不内置原生第三方代码或资源字节。准备完成的包按提交在本进程内缓存（最多两个版本），再确认时使用同一提交并核对摘要；重启后按同一来源重建并比较摘要。上游移动main不改变未过期的确认记录和已有安装。静态生成文件与许可证写入既有主题存储，公共图片/字体按固定blob校验并按需获取。安装后展示不需要编译。npm及esbuild是Node生产依赖，普通运行包无需系统安装这些工具；Worker尚不支持源码准备。

选定历史参考原文件保存在[参考目录](../references/upstream/mmwx-probe-source/README.md)，不是可执行副本；另只读核对App.tsx、PremiumProbePage.tsx、styles.css及Worker/构建配置，URL、Git blob及SHA-256见[独立清单](../references/mmwx-probe-manifest.json)。`src/themes/native-source.ts`提供动态目录读取与校验，不再交付静态源码索引。研究清单不混入新版本文件，新的安装保留自己的提交、摘要、实际许可原文及依赖声明，不把LeoBridge MIT套用给它。

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

## 支持范围与参考版本

来源级支持状态和已知显示限制统一见[兼容清单](compatibility.md#原生主题两个来源均已验证兼容)。

固定提交`723427b18ea23a59a923a89155ebe1f3fa3fa824`曾在本地Node配合真实源验证首页、资源历史与原生实时帧，四种外观另用合成源检查。7d Ping接口成功，但一次浏览器请求超时后仍显示旧1h曲线；Premium部分缺值显示0。主控Passkey、转发链完整业务及全部历史档位未完成独立验收。
