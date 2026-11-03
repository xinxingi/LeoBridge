# ADR 001：双生态主题与协议边界

日期：2026-11-02。状态：已实现并完成本地整合，云端待部署验收。

## 产品决定

LeoBridge提供独立轻量管理站和CFSM、Komari两个商店入口，服务器管理与采集留在妙妙屋X。一个站点同一时刻启用一个主题；主题资源与对应protocolProfile一起固定，安装、预览、启用和回退无需修改代码或重新部署。

内置CFSM默认前台及经过适配的Komari Adhesive Note是已进行真实浏览器验收的对象。商店可发现、包可安装、协议已验证兼容是三个独立状态；第三方包安装后默认`unverified`，明确确认启用也不自动提升兼容状态。当前v0.1不承诺所有第三方主题兼容。

## 数据与协议边界

- `src/upstream/client.ts`只访问配置的妙妙屋源，负责鉴权、超时、快照缓存；`src/core/identity.ts`负责公开描述信息到稳定桥接ID的显式绑定，不把历史下标当永久ID。
- `src/core/model.ts`使用字节、字节/秒、百分比和nullable状态；CFSM和Komari序列化各自独立，不把CFSM响应当作Komari输入。源端历史仍由妙妙屋保存，不新增采集或历史数据库。
- `src/protocols/cfsm/service.ts`、`cfsm.ts`及`realtime.ts`提供CFSM展示契约；`src/protocols/komari/service.ts`、`komari.ts`及`komari-realtime.ts`提供Komari只读JSON-RPC与有限REST/实时契约。适配器共享上游事实与缓存，各自处理输出和连接生命周期。
- `src/app/protocols.ts`创建协议应用，`src/app/site.ts`按不可变安装主机选择profile并分发静态资源、API和WS；Node/Worker只处理运行时监听、网络和存储。
- `web/themes/cfsm/`和`web/themes/komari/`是独立前台应用副本，保留来源、许可证、原始文件摘要及补丁清单；固定参考目录不作为应用运行，也未修改参考源码。

源端公开接口缺稳定ID的约束仍存在。历史查询前后核对整组身份与顺序只能检测部分竞态；历史读取期间不得调整公开列表或身份属性。上游Token、源地址及绑定仅在服务端，主题只能看到已授权公开的数据。

## 安装与版本路由

1. `catalog.ts`分别读取官方CFSM、Komari索引。管理站将最新main解析为具体SHA后展示，缓存60秒，显式刷新重新解析；安装携带用户看到的catalogRevision。固定参考索引仍可用于可复现离线测试。
2. `theme-package.ts`将CFSM分支固定到commit，对Komari ZIP检查目录SHA-256、清单身份、路径、压缩结构及许可证。只允许静态资产，不执行任意包内构建或服务端代码。静态引用能检查到的缺文件/外部依赖拒绝，动态引用仍需浏览器验证。
3. 安装资产完整写入后才发布元数据；文件清单、大小、类型及入口必须一致。失败保留active指针。每个安装记录ecosystem、来源、版本、许可证、入口、compatibility和protocolProfile。
4. 不可变地址采用`t-<32hex>.<displayDomain>`；预览采用`p-<32hex>.<previewOrigin主机名>`。使用独立主机保留主题原生绝对`/api`和`/assets`路径，避免靠正则改写压缩JS或让两种协议共用含糊路径。
5. 根展示入口307到当前active版本并保留路径/查询。启用与回退使用generation前置条件，冲突要求刷新。已打开的旧版本页面和WS继续对应旧资源/协议；不会中途把Komari响应发送给CFSM连接。回退只改变active/previous指针。

当前静态包限制为16,000,000字节压缩包、32,000,000字节展开总量、8,000,000字节单文件、1200条目和200倍压缩比。没有主题配置编辑UI：Komari raw/redirect拒绝，managed仅保留当前默认行为。没有卸载或孤立资产自动清理界面，运行维护不能删除仍被active/previous或旧页面使用的包。

## 存储决定

Node采用`FileThemeStore`：默认`work/theme-store`，资源不可变写入，元数据临时文件原子rename，通过文件锁串行化不同进程的写入。管理会话也在该私有状态中，不能提交或公开。

Workers采用`WorkerThemeStore`：每个安装在R2中保存一个拼接静态包对象，以元数据中的offset/size进行range读取单个资源。单站`ThemeCoordinator` Durable Object以事务串行化安装元数据、active/previous版本及管理会话。内置包和可信管理UI由`ASSETS`引导初始化。单对象包写入减少大量小资源初始化请求，不改变每资源路径与MIME。

DO的依据是主题管理事务与会话一致性，不是预先建设监控数据库；没有D1，DO/R2不持久化指标或历史。目前也没有跨isolate共享上游实时连接或全局限流，公开规模需按实际请求、CPU、连接、R2读写及DO成本评估。

Wrangler本地模拟已验证内置初始化和R2/DO路径。云R2资源尚未创建，DO迁移及正式部署尚未执行；本地模拟、dry-run均不能替代云端数据持久性、网络与成本验收。

## 管理与第三方脚本隔离

管理源使用独立主机名，HTTPS会话cookie为`__Host-`、Secure、HttpOnly、SameSite=Strict且无Domain；本机HTTP使用单独名称。非GET管理操作要求准确Origin及CSRF，退出删除服务端会话；无密码时拒绝登录。展示站Basic Auth与管理认证独立，上游Token不参与管理登录。

展示与预览使用不同主机，均不能共享管理cookie、管理脚本或安装权限。管理源不嵌入第三方主题；主题资源CSP限定同源资源与连接，禁止iframe、Worker/Service Worker及外部网络依赖，不开放带凭据通配CORS。第三方脚本仍能读取用户授权给该展示站的数据，预览不是不读取数据的沙盒。

Node默认管理8786、展示8787、预览8789且仅回环HTTP；Workers本地模拟采用不同主机同一8787端口。正式Worker部署必须覆盖根展示源、`*.displayDomain`、管理源和`*.previewOrigin`的DNS、路由及TLS，不能仅靠路径隔离。云资源、域名与部署需明确目标环境和授权；当前仍为待部署验收。
