# ADR 001：双生态主题与协议边界

决定日期：2026-11-02；更新：2026-11-03。状态：已实现，本地检查范围见[兼容清单](../research/compatibility.md)，Workers云端尚未验收。

## 产品与协议

LeoBridge提供轻量管理后台和CFSM、Komari两个商店，采集及服务器管理留在妙妙屋X。单站同一时刻启用一个主题，资源与protocolProfile一起固定。默认不交付第三方主题，已有安装保留；历史适配包的来源和补丁见[档案](../references/retired-themes/README.md)。

上游访问、中立模型、两套输出协议及运行时分离，依赖矩阵以[架构约定](../development/architecture.md)为准。两协议共享上游事实、身份检查及缓存，不互相转换响应。历史仍由妙妙屋X保存；不新增Agent、完整主控后端或指标数据库。

源接口缺少不可变ID，历史查询前后核对整组身份顺序只能发现部分竞态。历史读取期间不得调整公开列表或身份属性，不能静默映射歧义节点。Token、源地址及身份选择条件保留在服务端。

## 安装与发布

1. `src/themes/catalog.ts`分别解析两个官方目录，将main解析为具体SHA，缓存60秒；刷新重新解析。安装携带用户看到的catalogRevision。
2. `src/themes/package.ts`将CFSM构建分支固定到commit，按目录SHA-256核验Komari ZIP。检查来源、路径、配额和清单，外部/缺失资源引用作为诊断。CFSM保存固定资源索引并按需取文件，Komari保存原ZIP静态资源；不执行包内构建或服务端代码。
3. 管理员先查看固定版本、来源和许可文件，再主动确认。准备记录绑定会话、版本、摘要及文案版本，15分钟有效并持久化；安装重新下载核验，最终提交再校验记录。缺少许可明确提示，不作授权判断。
4. 资产完整写入后才公布安装元数据，失败不替换active。记录生态、来源、版本、许可资料、确认信息、入口、兼容状态及profile。
5. 启用与回退要求最新generation，冲突时刷新后重试。发现、安装与实测兼容独立；确认安装或启用都不自动将unverified提升为verified。

包限制与用户操作统一维护在[主题管理](../themes.md)，不在本ADR重复维护数值。尚无主题配置编辑、卸载及孤立资源清理UI，Komari raw/redirect配置声明可保存但不执行，managed使用默认值。

## 路由与隔离

- 默认single模式在同一端口以`/`展示、`/admin/`管理。根入口直接供应活动主题，切换或回退关闭根入口旧实时连接，刷新后加载新版本。同源路径不隔离第三方脚本，只应启用可信主题。
- isolated模式使用独立管理源，展示根入口307跳转当前版本。不可变展示地址为`t-<32hex>.<displayDomain>`，预览为`p-<32hex>.<previewOrigin主机名>`；旧版本页面及WS继续使用原协议。
- single预览使用同源`?__preview=<安装ID>`，注入请求/导航适配，按查询参数及同源Referer绑定版本，不改变原包字节。isolated预览与管理使用不同主机名。两种模式均保留主题的`/api`、`/assets`路径，不改写压缩JS；同源预览不能当作安全隔离。
- 会话为host-only、HttpOnly、SameSite=Strict；HTTPS下single使用`__Secure-`及`Path=/admin`，isolated使用`__Host-`及`Path=/`。写操作验证Origin/CSRF，退出或改密撤销会话；初始凭据和强制改密见[配置参考](../configuration.md#管理密码持久化)。
- 展示Basic Auth与管理认证独立。主题CSP允许HTTPS外部资源/连接、HTTPS iframe及同源/blob Worker，管理页策略独立。静态诊断和CSP不能代替浏览器验收或代码审计。预览可读取已授权展示数据。

## 存储与运行时

Node使用`FileThemeStore`保存不可变资源，以临时文件原子替换及文件锁提交状态。按单站、单进程、单副本部署，不能据文件锁推断可多主机共享写入。状态包括安装、active/previous、管理会话、密码摘要及后台保存的数据源凭据，须整体私有备份。

Workers在R2中为每个安装保存一个拼接静态对象，按offset/size读取资源；单站`ThemeCoordinator` Durable Object以事务管理元数据、会话及数据源配置。`ASSETS`仅提供自有管理界面和空主题清单。DO用于管理一致性，R2/DO不保存指标历史，不引入D1。

本地workerd曾验证历史双主题R2/DO路径；这不证明当前版本云端运行、持久性、网络或费用已验收。Workers没有跨isolate共享实时连接或全局限流，目标域名、TLS、R2/DO及额度的验证留待[Workers后续适配](../deployment/workers.md)，不作为当前交付要求。
