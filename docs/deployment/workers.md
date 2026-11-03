# Cloudflare Workers（实验性）

推荐使用[Linux VPS部署](vps.md)。Worker入口及R2/DO存储实现尚未完成Cloudflare云端部署验证，本文供维护和实验使用。

## 使用范围

Worker使用R2保存主题资源、Durable Object保存主题元数据与管理会话。使用前需配置独立管理、展示和预览域名，并在目标环境验证上游访问、持久化及WebSocket。

## 部署前审查

- [ ] 审查代码、锁文件、关键测试、两套前台补丁、许可证及真实浏览器记录；确认身份约束与历史读取期间列表不变的前提。
- [ ] 明确目标Cloudflare账号、Worker名、环境、域名及部署授权；不默认公开private数据。
- [ ] 决定`BRIDGE_ACCESS=public/private`。private配置独立展示用户名/密码；管理站另配用户名及至少20字符密码，上游Token不得复用。
- [ ] 运行`pnpm install --frozen-lockfile`、`pnpm check`、`pnpm deploy:dry-run`；以实际输出记录结果，不预填测试数量。
- [ ] 审查静态包限制、第三方CSP限制、未验证主题确认流程及尚无主题配置编辑UI的范围。
- [ ] 核实目标账号R2、DO、Worker存储/读写/CPU/连接额度和费用，决定访问规模与监控方式，不承诺免费或无限连接。

## 域名、资源和机密

- [ ] 为展示根`BRIDGE_DISPLAY_ORIGIN`配置DNS、HTTPS和Worker路由。
- [ ] 为`t-<ID>.<BRIDGE_DISPLAY_DOMAIN>`配置通配DNS/路由/TLS；证书必须覆盖实际版本层级，不假定普通根域证书自动覆盖。
- [ ] 为独立`BRIDGE_ADMIN_ORIGIN`配置DNS、HTTPS和路由。管理主机不可与展示/预览共用主机名，仅分端口或`/admin`路径不成立。
- [ ] 为`p-<ID>.<BRIDGE_PREVIEW_ORIGIN主机名>`配置通配DNS/路由/TLS，预览与展示及管理源独立。
- [ ] 将Wrangler中的本地HTTP源替换为目标HTTPS源；当前默认`workers_dev=false`，需明确决定是否启用，不能用单个workers.dev地址代替整套版本主机路由。
- [ ] 经授权创建/绑定`THEME_ASSETS` R2桶，核对`bucket_name`所属环境；R2不公开，也不存上游Token供主题读取。
- [ ] 配置单站`THEME_COORDINATOR` Durable Object及`theme-coordinator-v1`迁移，保留`ASSETS`用于内置包和管理UI。DO仅存安装元数据、指针、会话；无需D1或历史数据库。
- [ ] 使用Worker Secrets保存上游URL/Token、绑定、Ping选择、管理员密码及private展示凭据；不把值放命令参数、日志、前台或Git。普通标题和源配置可置于vars。
- [ ] 备份元数据及资源维护方案已明确：R2每包一个不可变拼接对象，DO记录每资源偏移和大小。不能只备份active指针而丢失包；无卸载/孤立包自动清理UI，清理须保留active/previous和旧版本访问需要的对象。

本地模拟默认管理、展示、预览分别使用不同主机但共用8787端口。执行`pnpm dev:worker --port 8787`前停止占用该端口的Node；显式`.dev.vars`源配置覆盖Wrangler vars时要保持端口一致。本地模拟资源与云端资源相互独立。

## 云端验收（必须部署后执行）

- [ ] 初次初始化两套内置包完成，R2完整写入后才公布元数据；资源MIME、缺资源404、SPA详情路由及HTML缓存行为正确。
- [ ] 管理登录、过期、退出、错误密码限速；HTTPS cookie具有`__Host-`、Secure、HttpOnly、SameSite=Strict且无Domain。
- [ ] 展示和预览不能读取管理接口或复用管理cookie；写管理操作拒绝错误Origin/CSRF，跨源WS拒绝。
- [ ] 两个商店可读取/刷新，目录固定SHA可追溯；安装携带所见revision，CFSM固定commit、Komari校验ZIP SHA，许可证和静态资源校验生效。
- [ ] 未验证包不自动标为兼容；预览后需明确确认启用。失败安装保留当前状态，并发启用/回退冲突不覆盖新状态。
- [ ] 两套内置前台首页、详情、静态资源、实际公开节点数量/隐藏设置正确；与上游公开列表一致。
- [ ] 1h/7d系统、Ping和丢包历史的点数、单位、零/缺失、时间轴正确，不补造历史。
- [ ] CFSM和Komari各自实际实时通道持续更新；HTTPS/WSS、源header鉴权、断线重连、过期及HTTP回退语义正确，关闭页面释放资源。
- [ ] 切换两种生态及回退后根入口指向正确版本；旧版本页面和WS继续原协议，不混用JSON格式或资源。
- [ ] private保护HTML、资源、HTTP和WS；预览仅可读取被授权展示数据，Token不进入前台、资源或日志。
- [ ] Cloudflare真实出站可访问主控及官方主题来源；不能把本机代理或workerd模拟结果当作云端网络证据。
- [ ] 记录实际部署版本、环境、时间、可回退版本、失败与限制；未执行或失败项不能标为通过。

## 当前兼容范围

内置经过补丁的CFSM默认前台与Komari Adhesive Note是实际浏览器验收对象。商店原包默认未验证，不能据内置包的兼容状态推断所有CFSM/Komari主题兼容。主题配置UI尚未实现，raw/redirect配置拒绝，managed配置使用当前默认行为；外链资源、iframe及Service Worker受CSP阻断。服务器管理、采集、终端、远控和告警继续不在LeoBridge范围内。
