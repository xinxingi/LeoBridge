# 架构与目录约定

LeoBridge保持一个TypeScript项目、一个pnpm锁文件。用户交付采用Docker Hub镜像及自带Node的运行包两种方式；Worker入口保留供后续适配。按现有职责分层，不引入Monorepo框架、依赖注入容器或新数据库。

## 数据流与组合

```mermaid
flowchart LR
  Source[妙妙屋X HTTP / WS] --> Upstream[upstream: 快照与历史]
  Upstream --> Native[protocols/native: 原生公开接口]
  Native --> Site
  Upstream --> CFSM[protocols/cfsm]
  Upstream --> Komari[protocols/komari]
  CFSM --> Site[app: 版本路由]
  Komari --> Site
  Themes[themes: 不可变资源与状态接口] --> Site
  Management[management: 认证及主题管理] --> Site
  Site --> Runtime[runtime: Node / Worker]
```

这是数据/请求组合图，具体代码允许的导入方向以下表为准。共享模型和历史事实不含CFSM响应结构，两个协议各自转换；`app/protocols.ts`注入同一上游快照客户端，保持缓存与身份事实一致。默认single路由的根入口直接绑定当前活动主题，`/admin/`提供管理，切换活动主题关闭根入口旧实时连接。single预览以`__preview`参数绑定安装资源及协议；`app/preview.ts`负责浏览器请求/历史导航适配和同源资源Referer重定向，不修改原始包，不使用全局预览Cookie。版本/预览主机继续支持；isolated路由保留根入口跳转。

## 目录和依赖边界

| 目录 | 职责 | 允许导入的项目层 |
| --- | --- | --- |
| `src/core` | 统一模型、身份、配置、错误、HTTP封装及Socket接口 | core |
| `src/upstream` | 妙妙屋HTTP读取、缓存/超时、中立历史序列 | core、upstream |
| `src/protocols/native` | 原生公开字段、身份槽位、原生历史及实时访问 | core、upstream、native本层 |
| `src/protocols/cfsm` | CFSM服务、序列化、Ping、历史和订阅 | core、upstream、cfsm本层 |
| `src/protocols/komari` | Komari RPC/REST、序列化及实时 | core、upstream、komari本层 |
| `src/themes` | 商店、静态包校验、固定资源来源/按需缓存、安装确认及状态契约 | core、themes |
| `src/management` | 独立认证、管理API与源配置 | core、themes、management |
| `src/app` | 组合协议应用与站点路由 | 上述中立/功能层、app |
| `src/runtime` | Node/Worker入口、文件/R2/DO存储、代理 | 上述层、runtime |
| `web/admin` | 可信管理界面 | 仅管理HTTP API |
| `deploy` | 容器、反向代理及服务管理配置示例 | 不承载业务逻辑 |
| `scripts` / `tests` | 构建、初始化、架构检查和验证 | 可以组合被测模块，不被产品代码导入 |

不新增空层或无用途的`index.ts`。目前具体入口文件就是公开契约，例如`core/socket.ts`、`themes/store.ts`；新增可复用包后再考虑package exports。活动主题由持久化管理状态决定，不默认选择CFSM。产品构建只包含管理资源；历史主题来源档案不参与构建。

`pnpm check:architecture`用TypeScript AST读取import、export、import type和字面量动态import，拒绝跨层/跨生态依赖、缺失模块、依赖环和无法检查的动态模块加载。Node内置模块及Node专用传输依赖仅允许在runtime；Worker入口会递归检查可达依赖，避免误带Node能力。它是项目内约束检查，不代替类型、行为测试或供应链审查。

## Node运行与反向代理边界

本地Node和Docker部署负责应用进程、HTTP监听及持久化，不管理域名或证书。DNS由部署者配置，站点反向代理、HTTPS终止和证书生命周期交给nginx或Caddy。应用约定HTTPS来源、Host及可信客户端IP的传递方式，不依赖nginx或Caddy的产品接口；Docker Compose只启动应用、映射端口并绑定部署目录的./data，反向代理由部署者独立管理。

`deploy/local/leobridge.sh`在源码仓库集中存放，打包时复制为运行包根目录的`leobridge.sh`；脚本只运行已有产物，使用包内Node或开发者已有Node，不下载、安装依赖或构建。`scripts/local-service.ts`编译为`dist/local-service.js`，使用Node内置模块管理后台进程、日志和启停；控制记录位于`work/local`，不混入主题业务存储。`scripts/package-local.ts`只供开发/发行阶段使用，按白名单打包Node、应用、生产依赖及许可证，省略源码、开发工具和私有状态；构建流程见[开发构建指南](build.md)。管理进程通过IPC等待Node入口全部端口就绪；应用在管理IPC断开时退出，避免遗留写入者。回环控制端口使用私有令牌，不按持久化PID直接终止进程；控制逻辑不进入Worker或协议层。

Node默认single路由只开一个监听端口，local使用回环HTTP，Docker内置direct并仅映射宿主回环端口。single在两种模式下按配置的公开站点协议生成请求URL及Cookie，支持外部HTTPS反代；不信任转发头。proxy仅供需要严格验证代理来源和采信真实客户端IP的高级部署。旧local+isolated配置保留多端口行为。高级proxy下只有允许的代理IP/CIDR可以提供单值`X-Forwarded-Proto=https`和`X-Real-IP`。Host必须匹配配置源或有效版本域；HTTP与WS使用同一验证函数。来自客户的Forwarded/X-Forwarded-Host/CF-Connecting-IP不能改变路由或绕过管理节流。

NODE_ENV=production或direct/proxy模式默认不读取`.dev.vars`。配置来自环境变量或显式`BRIDGE_ENV_FILE`；环境覆盖文件，日志不输出内容。Node新实例文件存储在启动目录的./data；检测到旧work/theme-store时要求显式选择或迁移，不静默创建空站点，按单站单副本运行。请求/WS有大小和数量界限，退出停止新请求、关闭上下游连接、终止出站连接池并限定排空时间。健康检查只检查进程，不访问真实源。`--check-config`复用启动校验后立即退出，不初始化存储或监听；single的direct/local接受HTTP监听与HTTPS公开源分离，仍核对精确Host、Origin及CSRF，按socket来源限流。代理拒绝只在日志记录首次socket来源，不记录请求头、路径或凭据。

## 修改与验证

- 修改中立事实/单位时跑两个协议的转换和历史测试；身份约束不得因主题变化而降级。
- 修改主题包处理或协议时，保留固定来源、摘要及兼容限制；最终兼容结论需要实际浏览器验收。历史主题档案不参与构建，目录搬迁仍须核对资源摘要。
- 修改Node入口时验证HTTP/WS反代、Origin/CSRF、客户端地址和持久化重启；反代模拟不等于真实nginx/TLS或VPS通过。
- 新上游适配实现中立模型；新主题生态实现独立协议。不得让协议之间通过互相调用响应转换来“兼容”。
- 运行`pnpm check`；Worker维护另运行`pnpm build:worker`。CI和本地实际结果分别记录。

## 后台数据源初始化

`core/source.ts` 定义私有数据源配置与检查草稿，`management/source.ts` 负责已认证的检查/确认流程，`app/site.ts` 注入上游只读快照读取。配置通过既有状态存储原子提交，独立版本号防止覆盖；不新增数据库。管理密码摘要与数据源同存state.json（Worker为私有DO状态），不读取初始密码或数据源环境变量。空源只运行管理与初始化引导；保存后重新组合两个协议并清理旧连接/缓存，公开主题状态排除数据源凭据。

## 商店下载传输

`core/store-proxy.ts`定义私有代理配置及URL校验；`management/store-network.ts`管理配置状态及下载任务的传输注入，主题目录/安装器继续只消费`PublicFetcher`。`runtime/store-transport.ts`用配套的undici fetch与Agent/ProxyAgent建立每个任务独立的HTTP(S)传输，在全部下载结束后销毁；代理切换不修改全局dispatcher或主控连接，不在失败时回退直连。代理配置通过既有ThemeStore原子事务持久化，从公开主题状态中剔除，认证URL不回显。Worker没有Node传输注入，明确拒绝代理配置及使用代理的下载。


## 原主题资源与展示上下文

`themes/resources.ts`通过注入的商店传输按固定版本读取静态资源，不接触源端凭据；本地/主题自己的资源优先，已识别公共库及生态官方公共图像补缺。来源清单仅包含URL与摘要，不交付第三方资源字节。`core/presentation.ts`承载当前安装的主题标识及默认设置，`app/site.ts`在HTTP和WS请求入口绑定，协议层不读取主题仓库或其他生态的响应。展示HTML不再注入数据说明；预览仍保留请求及历史导航适配，原包文件及摘要不变。主题HTTPS外链由浏览器读取，管理UI不执行主题配置代码。


## 原生源码准备

原生目录登记官方`mmwx-group/mmwx-probe`（`mmwx-probe`）与社区`chnnic/jiwo-probe`（`jiwo-probe`），按各自main解析到本次固定提交；`themes/native-source.ts`动态读取该提交的完整Git树，验证前台源码/公共资源路径、类型、blob摘要、大小及入口，不再保存固定版本白名单。`runtime/native-build.ts`在Node按需下载、安装锁定依赖并用自有esbuild配置构建原生前台，缓存和并发任务按来源标识与提交共同隔离。npm生命周期脚本禁用，不执行上游Worker/构建配置。Jiwo的主页面和Ran独立`map.html`一起构建，`@`别名由桥接器配置为临时源码中的`src/ran`。源码不进入LeoBridge仓库；下载与依赖安装只使用临时目录，成功或失败均清理，持久化安装仅保留静态产物、许可与固定资源索引。管理层经`StoreNetwork`传入确认的来源标识、提交和下载传输，Worker不能导入npm/esbuild或Node构建器。原生协议在`protocols/native`独立访问上游；展示槽位映射显式绑定，历史前后仍核对源身份顺序。研究参考清单仍保存历史审计版本，不作为运行时更新门槛。

Jiwo的可选`/api/theme-config`和`/api/visitor`辅助接口仅在该安装的展示上下文提供：空显示配置沿用前台自带默认值，访客资料明确为UNKNOWN/null等未知值；Node不伪造Cloudflare地理信息，不代理主控登录。数据快照、历史和实时继续使用独立原生协议。

原生外观选择保存在Installation.nativeTheme中，旧安装缺省为source；管理事务校验会话、原生协议及generation。展示上下文传递给原生HTTP/WS，仅覆盖appearance.theme。Site在原生WS发送前核对对应安装的设置，设置变更后关闭旧连接，避免旧快照覆盖新HTTP外观；预览和版本主机同样适用。原生资源包和摘要不因外观选择变化。


## 安装版本更新与删除

管理层prepare-update按Installation.ecosystem/themeId解析最新官方目录并准备固定包，与原安装digest比较；复用session review、许可确认和commitInstallation，新包不自动激活。原生按安装的themeId查询对应上游main；只有最新提交与已安装提交相同时才跳过重建并报告最新，其他提交进入按需构建。确认安装继续使用review内的提交，不重新解析main。更新关联保存在review.updateOf，最终事务校验原安装仍存在并继承原生外观；已经存在的新安装保留自身设置。管理state通过themes/native-appearances按每个已安装包的CSS根选择器、JS appearance.theme字面量比较及具有固定字段结构的原生主题菜单返回动态外观列表；只读本地资源、按不可变安装缓存，不改包摘要或安装状态。已知ID中文翻译不作为能力清单，接受符合上游约定的自定义标识。静态发现依赖上游实现约定，不能替代完整目录或实际兼容验收。

Node的uninstall在同一文件事务锁内校验会话、generation、当前启用和上一版本确认，先公布元数据删除及pendingAssetCleanup，再删除packages/<id>，最后原子移除待清理记录。失败或进程中断后可重试，待清理期间禁止重新安装相同ID。管理层将下载、安装、删除串行化；仍以单站单进程单副本为部署约束。Worker未声明supportsUninstall，不提供仅删除元数据却遗留R2对象的入口。

Site按安装ID跟踪三个协议的预览/版本实时会话；删除后立即关闭本Site内对应连接，并在转发每帧前重新核对安装存在及原生外观。新请求继续通过既有版本路由核对安装状态。

## 数据接口目录

管理页「数据接口列表」使用web/admin/data-interfaces.js中的只读契约目录，按原生、CFSM和Komari三种协议分组，接口提供方独立标记为主控或桥接器；筛选、格式转换与衍生计算等处理方式在详情中说明。目录记录主要字段、来源/转换/计算、参数、接入范围与验证依据，不携带源凭据、不探测接口，也不增加数据协议端点。管理页按需加载模块；Node与Worker沿用同一管理静态资源白名单。页面直接显示搜索、筛选和接口列表；所有条目的当前实例状态均明确为未检查。修改协议service、adapter、metrics或prepared-data时，应同步核对目录，不能用目录接入标签代替真实接口或主题验收。
