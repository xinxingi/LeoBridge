# 排障

不要粘贴`.dev.vars`、主题存储中的会话或原始响应到工单/日志。真实只读复验使用CFSM `pnpm verify:live`及Komari `scripts/verify-komari.ts --origin <实际版本源>`；原始证据仅在忽略目录。安装成功、HTTP 200、WebSocket open与真实主题完整兼容是不同检查。

## 启动、入口与管理

| 现象/错误码 | 检查与行为 |
| --- | --- |
| 运行包缺文件 / Node不可用 | 核对系统和架构，重新下载完整运行包并校验摘要；不要下载Source code源码归档。启动脚本不安装依赖或编译，自行构建见[开发文档](development/build.md) |
| 本地脚本启动失败 / 端口占用 | 用`./leobridge.sh logs`检查日志，确认配置、资源和端口；脚本只有在全部端口就绪后才报告成功。不要与另一运行包实例同时写同一状态目录 |
| command.lock遗留 | 先确认没有启停命令或其子进程仍在执行，再移除`work/local/command.lock`；异常中断不会自动猜测并删除锁 |
| 控制身份校验失败 / 记录进程仍存在 | 不要按service.json中的PID盲目kill；先核对该进程是否为本实例、是否正在退出。确认本实例所有进程已结束后才移走`work/local/service.json`并重新start；该文件含私有控制令牌，不要外传 |
| Theme initialization failed / 缺资源 | 本地先stop，保留业务状态和配置，再重新解压完整运行包并start；包中应有管理资源及空主题清单`dist/bundled`；第三方主题由商店安装到状态目录，已有安装需完整迁移 |
| 版本地址无法解析 | 浏览器需支持`*.localhost`回环解析；保留管理站生成的`t-<ID>.display.localhost`或`p-<ID>.preview.localhost`主机名，改成IP会改变路由 |
| 根入口307 | isolated模式正常跳转到当前安装版本；single模式直接供应当前主题。API脚本须选择对应协议的根源或版本源 |
| 改PORT后404 / Bad host | `PORT`影响Node默认单端口；显式origin或`BRIDGE_LISTEN_PORT`优先。旧isolated配置保留各端口，核对origin与监听器一致 |
| Node配置https源后404 | Node的local模式使用HTTP；HTTPS反代部署应配置proxy模式、HTTPS源和可信代理，见[Docker部署](deployment/docker.md) |
| PASSWORD_CHANGE_REQUIRED / 403 | 首次登录须先改密；默认初始账号/密码为admin/admin，已有自定义配置继续使用。改密后重新登录，不重复生成初始化配置 |
| LOGIN_FAILED / LOGIN_THROTTLED | 使用管理凭据而非探针Token或展示密码；连续失败会限速，等待后核对本机私有配置 |
| LOGIN_REQUIRED / 401 | 会话过期或已退出，回管理源重新登录；展示/预览不会携带管理cookie |
| ORIGIN_ISOLATION / MANAGEMENT_CONFIGURATION | isolated模式管理、展示、预览须不同主机名；single仅允许管理与根展示同源，预览仍独立。核对路由模式、origin及HTTPS配置 |
| ORIGIN_REJECTED / CSRF_REJECTED | 从配置的管理源操作，重新登录获取会话与CSRF；不要关闭校验或将管理页面代理到主题主机 |
| REVISION_CONFLICT / 409 | 另一页面已改变安装或启用状态；刷新管理站，检查当前/上一版本后重新操作 |
| PREVIEW_REQUIRED / 409 | 商店包未经实测，先预览再明确确认；确认启用不会自动把兼容状态变成verified |
| STORE_BUSY / 503 | 另一Node进程正在写主题状态。若异常退出遗留`work/theme-store/state.lock`，先确认所有使用该目录的进程已停止、备份状态，再移除遗留锁；不可在仍有写入者时删除锁 |
| STORAGE_CONFIGURATION / 503 | Worker缺少`THEME_ASSETS` R2或`THEME_COORDINATOR` DO绑定；本地模拟与云端资源分别配置 |

Node状态默认在`work/theme-store`，包括安装资源、管理会话、密码摘要及后台保存的数据源凭据；不要提交、随意删除或与不同站点共享。安装先写资源再发布元数据，失败可能留下未发布资源，当前无卸载/自动清理UI；不要为释放空间直接删除active/previous或仍有旧页面访问的资源。

## 商店与主题包

| 现象/错误码 | 检查与行为 |
| --- | --- |
| 商店暂未更新 | 通常缓存60秒；刷新按钮重新解析官方main并固定到SHA。刷新失败会显示失败，不冒充新目录成功 |
| CATALOG_REVISION | 刷新目录再选主题；安装提交用户所见revision，不能省略或改用任意URL |
| INSTALL_CONFIRMATION_REQUIRED | 先查看来源和许可信息，再主动勾选确认。缺失或未知许可会提示，不单独阻止安装；用户确认不是授权证明 |
| INSTALL_REVIEW_EXPIRED / INSTALL_PACKAGE_CHANGED | 准备记录已过期、会话变更或下载内容变化；重新准备并查看固定版本，不跳过摘要校验 |
| PACKAGE_SHA256 / LICENSE_HASH | 下载内容和固定摘要不一致，停止安装并核对官方目录；不能删除摘要检查 |
| ZIP_* / PACKAGE_SIZE / PACKAGE_PATH | 包超过静态限额、路径/压缩结构不安全或特殊文件不受支持；不执行包内程序来“修复” |
| ASSET_MISSING / EXTERNAL_ASSET | 包缺本地资源或依赖外部静态资源；先审查资源与许可，不通过放开CSP掩盖问题 |
| MANIFEST_CONFIGURATION | raw/redirect配置被拒绝；managed配置尚无编辑UI，安装不等于主题设置已支持 |
| 主题安装后白屏、外链/Service Worker被阻断 | 检查浏览器控制台和主题实际协议；CSP仅允许受控同源资源，阻断Worker/iframe及外部请求。动态引用需浏览器验收，不保证所有主题兼容 |
| 主题API字段错误 | 查看`/__bridge/version`的ecosystem/profile；CFSM与Komari协议不同，检查是否打开了正确版本主机 |
| 回退后旧页面未变化 | 设计行为：旧版本主机继续固定原资源与协议；从展示根入口重新进入当前版本 |

## 上游、身份和数据

| 现象/错误码 | 检查与行为 |
| --- | --- |
| SOURCE_NOT_CONFIGURED / 503 | 到后台数据源设置检查连接、核对节点身份和Ping目标后保存；空配置启动不是故障 |
| SOURCE_CONFLICT / SOURCE_CHANGED / 409 | 数据源或检查结果已变更，刷新并重新检查；保留原稳定ID，不以重建全部身份消除冲突 |
| CONFIGURATION | 上游必须为origin；检查展示访问策略及独立密码，不输出值 |
| IDENTITY_CONFLICT / 409 | 核对改名、隐藏属性、增删节点、重复匹配；保留原id审查match，不能把下标当id |
| IDENTITY_CHANGED / 409 | 历史期间公开列表顺序变化，结果已丢弃；列表稳定后再读。前后校验不能消除短暂重排再复原的竞态 |
| UPSTREAM_HTTP / 502 | 上游HTTP失败；保护开启而Token缺失可能404。核对服务端密钥，不关闭保护排障 |
| UPSTREAM_TIMEOUT / 504 | 握手或读取超时，检查授权网络与源站并只读重试；不能认定服务器离线 |
| curl代理成功但Node/WS仍失败 | Node需显式配置`BRIDGE_DEV_PROXY`接入HTTP和WS Agent并重启；不能据curl成功认定后端已使用代理 |
| Wrangler有代理提示但workerd超时 | CLI代理不代表workerd出站；需要本机代理时使用Node并配置BRIDGE_DEV_PROXY，分别检查本地与云端网络 |
| UPSTREAM_UNAVAILABLE / 502 | DNS/TLS/连接中断；不改主控配置或把Token/源地址放进浏览器查询参数 |
| PROBE_DISABLED / 503 | 源端未开放探针，清除旧展示；不能用空列表冒充成功 |
| HISTORY_RANGE / UPSTREAM_HISTORY | 范围不支持、success=false或历史契约变化；七天需`history_days>=7`及实际协议支持，不补0或造曲线 |
| 数据过期、实时重连 | WS连接建立不等于新采样；看观察时间、transport和恢复。HTTP回退不是原生WS实时验证 |
| “—”或空图 | 未提供/未验证能力不等于0；计费和网卡流量不混用，显式8目标选择不等于源端全目标 |
| private展示401 | 使用独立展示Basic Auth；上游Token和管理员cookie均不能登录展示站。版本和预览是不同源，浏览器可能分别提示 |
| Worker出站/WS失败 | 分别检查本地workerd和云运行时，dry-run不验证Cloudflare网络、TLS、域名路由或额度 |

绑定初始化仅用于尚无绑定配置。修复时保留私有`.dev.vars`和稳定ID，不自动重生成。源端没有足够的公开辨识信息时需要稳定公开标识，不能用随机UUID掩盖歧义。历史读取期间不调整公开列表/身份属性，详见[身份约束](configuration.md#身份约束)。
