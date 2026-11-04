# 排障

先确认应用版本、部署方式和失败步骤，仅分享脱敏错误。不要粘贴`.dev.vars`、主题存储中的会话或原始主控响应。安装成功、HTTP 200、WebSocket open与真实主题完整兼容是不同检查。

## 下载与版本

| 现象 | 处理 |
| --- | --- |
| 不知道下载哪个文件 | [Release](https://github.com/xinxingi/LeoBridge/releases)中的Linux x64包对应x86_64，arm64包对应aarch64/arm64；一起下载同名.sha256。Source code是源码，不是运行包 |
| Release页面或附件404 | 核对仓库地址、标签及访问权限；私有仓库须用有权限的GitHub账号登录。不能仅凭404认定尚未发布；不要把登录令牌写到公开命令或工单 |
| Docker拉取latest失败 | 核对Docker Hub是否存在该标签、网络及发布结果；也可在Compose中指定已存在的固定版本。latest需pull并重建容器才更新，版本标签不带v |
| no matching manifest / Exec format error | 核对目标系统与CPU架构；当前发行只提供Linux x64/amd64和arm64，Linux运行包不能在macOS/Windows直接运行 |
| 校验文件不匹配 | 停止解压或升级，确认运行包及.sha256来自同一个Release并重新下载；不能跳过摘要校验 |

维护者遇到Actions中同标签Release已存在时，按[发布恢复步骤](development/releasing.md#旧工作流报同标签release已存在)处理，不需要用户重新编译。

## 登录和配置没有按预期生效

先确认当前实例使用的状态目录或Docker卷；全新程序配上旧状态仍是已有实例，不会重新初始化。配置来源和保存位置见[配置参考](configuration.md#配置在哪里修改和保存)。

| 遇到的问题 | 该怎么处理 |
| --- | --- |
| 新安装用admin/admin登录失败 | 检查管理用户名和状态目录；已有密码状态使用当前密码，新状态使用默认密码admin并强制改密 |
| 修改旧初始密码变量没有效果 | 该变量已移除，管理密码只在后台修改，保存成功后重新登录 |
| 后台改密成功，但`.dev.vars`或`.env`没变 | 正常：密码摘要与数据源统一保存到state.json，运行配置文件不保存管理密码 |
| 提交新密码后仍在改密页 | 查看错误提示。新密码须为12–128位、含大小写字母、数字和符号；失败不会修改密码。只有收到成功提示后才使用新密码登录 |
| 修改旧数据源环境变量没有效果 | 这些变量已移除，请在后台“设置 → 数据源”检查、核对并保存；旧版本迁移见配置参考 |
| 数据源检查成功，重启却没保留 | “检查连接”只生成待确认结果，还须核对节点身份、Ping目标并点击“保存并应用”。核对重启前后使用同一状态目录或卷 |
| Token输入框是空的 | 不回显Token是正常行为。同一主控留空保留当前Token；换主控必须重新填写 |
| Docker改了.env仍无变化 | 新版模板直接填写YAML，不读取.env；修改实际使用的Compose后执行docker compose up -d重建，restart不更新环境。旧模板是否读取.env取决于有无变量引用 |
| 重新下载或构建后又出现初始化 | 核对是否换了`BRIDGE_THEME_STORE`、启动目录或Compose的data绑定目录。停止实例后恢复原状态路径或完整备份，不要同时写同一目录 |

**忘记当前密码：目前没有自助找回或专用本地重置命令。** 请保留并备份完整状态目录，联系维护者处理；不要删除`state.json`、整个状态目录或Docker卷，它们同时保存主题、数据源和会话。

## 启动、入口与管理

| 现象/错误码 | 检查与行为 |
| --- | --- |
| UNKNOWN_HOST / 421 | 请求的协议、主机、端口须与BRIDGE_ORIGIN一致。新版默认HTTP监听按配置的站点协议识别地址；HTTPS反代保留原Host即可。源不含/admin/或末尾/，详见[Docker反代步骤](deployment/docker.md#对接已有反向代理) |
| STORAGE_PERMISSION / 503 | 数据目录或文件权限不足，日志标明运行UID/GID；Docker默认1000:1000，按[权限修复](deployment/docker.md#升级与排障)调整宿主目录。旧版登录可能只报“桥接器内部错误”，也应先查目录权限 |
| STORAGE_READ_ONLY / STORAGE_FULL / STORAGE_IO | 分别检查数据目录只读挂载、磁盘空间/inode/配额、磁盘或挂载故障 |
| STORAGE_PATH / STORAGE_INVALID_STATE | 核对目录与state.json类型；JSON损坏时保留数据并从完整备份恢复，不删除状态重新初始化 |
| STORAGE_MIGRATION | 默认数据目录已改为./data；发现旧work/theme-store时拒绝静默切换，停机完整迁移或显式设置BRIDGE_THEME_STORE沿用旧目录 |
| 原生主题提示「请检查数据源 Token」 / UPSTREAM_AUTH / UPSTREAM_NOT_FOUND | 主控401/403表示拒绝访问；404也可能由Token失效、地址变更或独立探针接口关闭导致。管理员在「设置 → 数据源」核对地址、更新Token、检查连接后保存，再点展示页「重新检查」。新提示随桥接器升级生效，已有主题无需重装；不向页面回显Token或上游响应正文 |
| 旧版提示HTTPS必须proxy | 这是旧版本校验；新版本支持默认HTTP监听加HTTPS公开源。旧镜像继续沿用原有效配置，不能仅替换精简模板，须升级配套镜像 |
| UNTRUSTED_PROXY / 403 | 仅高级proxy模式触发，核对BRIDGE_TRUSTED_PROXIES；新版日志首次记录peer（socket实际来源），确认属于代理再加入精确IP。宿主反代通常经Docker网关；容器反代通常为代理容器IP，不能盲信整个私有网段 |
| BAD_REQUEST / 反代协议头 | 仅高级proxy模式要求代理覆盖单值X-Forwarded-Proto=https；重复值、http或缺失均拒绝。不要把HTTP请求伪装成HTTPS |
| healthy但域名无法访问 | healthz只检查进程；还需检查DNS、证书、代理、站点源和登录。修改应用环境需重建应用；修改Caddyfile需校验并重载Caddy |
| 原生主题准备空间不足 | Docker将/tmp绑定到部署目录的./tmp，检查宿主磁盘空间及该目录的UID/GID1000写权限；不再使用512MiB tmpfs。异常残留可在停止应用后清理tmp内容，保留目录及权限，勿删除data |
| 运行包缺文件 / Node不可用 | 核对系统和架构，重新下载完整运行包并校验摘要；不要下载Source code源码归档。启动脚本不安装依赖或编译，自行构建见[开发文档](development/build.md) |
| 本地脚本启动失败 / 端口占用 | 用`./leobridge.sh logs`检查日志，确认配置、资源和端口；脚本只有在全部端口就绪后才报告成功。不要与另一运行包实例同时写同一状态目录 |
| command.lock遗留 | 先确认没有启停命令或其子进程仍在执行，再移除`work/local/command.lock`；异常中断不会自动猜测并删除锁 |
| 控制身份校验失败 / 记录进程仍存在 | 不要按service.json中的PID盲目kill；先核对该进程是否为本实例、是否正在退出。确认本实例所有进程已结束后才移走`work/local/service.json`并重新start；该文件含私有控制令牌，不要外传 |
| Theme initialization failed / 缺资源 | 本地先stop，保留业务状态和配置，再重新解压完整运行包并start；包中应有管理资源及空主题清单`dist/bundled`；第三方主题由商店安装到状态目录，已有安装需完整迁移 |
| 预览地址无法访问 | 默认single模式从后台重新打开同域名`?__preview=<ID>`链接；旧子域书签不用于默认公网预览。isolated模式仍须配置版本/预览子域的DNS及证书 |
| 预览资源或详情错乱 | 检查代理是否保留完整查询参数及同源Referer，是否覆盖Referrer-Policy或强制缓存；特殊主题需逐包检查，见[主题管理](themes.md) |
| 根入口307 | isolated模式正常跳转到当前安装版本；single模式直接供应当前主题。API脚本须选择对应协议的根源或版本源 |
| 改PORT后404 / Bad host | `PORT`影响Node默认单端口；显式origin或`BRIDGE_LISTEN_PORT`优先。旧isolated配置保留各端口，核对origin与监听器一致 |
| Node配置https源后404 | 新版single默认HTTP监听可接入HTTPS反代；核对BRIDGE_ORIGIN与代理保留的Host/路径，并确认使用配套新版程序，见[Docker部署](deployment/docker.md) |
| PASSWORD_CHANGE_REQUIRED / 403 | 新实例使用默认密码admin，必须先改密；改密后使用新密码重新登录 |
| LOGIN_FAILED / LOGIN_THROTTLED | 使用当前管理用户名和密码；连续失败会限速，等待后按上方登录排障核对初始配置与已保存密码，勿将Token当作管理密码 |
| LOGIN_REQUIRED / 401 | 会话过期或已退出，回管理源重新登录；展示/预览不会携带管理cookie |
| ORIGIN_ISOLATION / MANAGEMENT_CONFIGURATION | isolated模式管理、展示、预览须不同主机名；single模式三者同源，预览用版本参数。核对路由模式、origin及HTTPS配置 |
| ORIGIN_REJECTED / CSRF_REJECTED | 从配置的管理源操作，重新登录获取会话与CSRF；不要关闭校验或将管理页面代理到主题主机 |
| REVISION_CONFLICT / 409 | 另一页面已改变安装或启用状态；刷新管理站，检查当前/上一版本后重新操作 |
| PREVIEW_REQUIRED / 409 | 商店包未经实测，先预览再明确确认；确认启用不会自动把兼容状态变成verified |
| STORE_BUSY / 503 | 另一Node进程正在写主题状态。若异常退出遗留`data/state.lock`，先确认所有使用该目录的进程已停止、备份状态，再移除遗留锁；不可在仍有写入者时删除锁 |
| STORAGE_CONFIGURATION / 503 | Worker缺少`THEME_ASSETS` R2或`THEME_COORDINATOR` DO绑定；本地模拟与云端资源分别配置 |

Node状态默认在`data`，包括安装资源、管理会话、密码摘要及后台保存的数据源凭据；不要提交、随意删除或与不同站点共享。安装先写资源再发布元数据，失败可能留下未发布资源，当前无卸载/自动清理UI；不要为释放空间直接删除active/previous或仍有旧页面访问的资源。

## 商店与主题包

| 现象/错误码 | 检查与行为 |
| --- | --- |
| 商店暂未更新 | 通常缓存60秒；刷新按钮重新解析官方main并固定到SHA。刷新失败会显示失败，不冒充新目录成功 |
| CATALOG_REVISION | 刷新目录再选主题；安装提交用户所见revision，不能省略或改用任意URL |
| INSTALL_CONFIRMATION_REQUIRED | 先查看来源和许可信息，再主动勾选确认。缺失或未知许可会提示，不单独阻止安装；用户确认不是授权证明 |
| INSTALL_REVIEW_EXPIRED / INSTALL_PACKAGE_CHANGED | 准备记录已过期、会话变更或下载内容变化；重新准备并查看固定版本，不跳过摘要校验 |
| PACKAGE_SHA256 / LICENSE_HASH | 下载内容和固定摘要不一致，停止安装并核对官方目录；不能删除摘要检查 |
| ZIP_* / PACKAGE_SIZE / PACKAGE_PATH | 包超过静态限额、路径/压缩结构不安全或特殊文件不受支持；不执行包内程序来“修复” |
| 缺失/外部资源诊断 | 当前版本将静态外链及未找到的依赖作为诊断，不因资源不自包含直接拒绝安装。先看浏览器实际失败的资源URL、来源及网络；旧版本的ASSET_MISSING/EXTERNAL_ASSET安装错误不代表当前策略 |
| MANIFEST_CONFIGURATION | 清单配置不是对象或超过大小限制；raw/redirect声明可保存但不执行，managed使用默认值，尚无配置编辑UI |
| 主题安装后白屏、外链加载失败 | 检查浏览器控制台、CORS、客户端网络及主题所需协议。主题允许HTTPS外链、HTTPS iframe和同源/blob Worker；管理页策略独立。HTTP混合内容或不受支持的API仍可能失败，不能以安装成功推断所有依赖可用 |
| 主题API字段错误 | 查看`/__bridge/version`的ecosystem/profile；CFSM与Komari协议不同，检查是否打开了正确版本主机 |
| 回退后旧页面未变化 | 设计行为：旧版本主机继续固定原资源与协议；从展示根入口重新进入当前版本 |

## 上游、身份和数据

| 现象/错误码 | 检查与行为 |
| --- | --- |
| SOURCE_NOT_CONFIGURED / 503 | 到后台“设置 → 数据源”检查连接、核对节点身份和Ping目标后保存；空配置启动不是故障 |
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
| private展示401 | 使用独立展示Basic Auth；上游Token和管理员cookie均不能登录展示站。默认single预览同源，isolated版本与预览使用不同源，浏览器可能分别提示 |
| Worker出站/WS失败 | 分别检查本地workerd和云运行时，dry-run不验证Cloudflare网络、TLS、域名路由或额度 |

节点身份在后台检查并确认保存。修复时保留已保存的稳定ID，不自动重生成。源端没有足够的公开辨识信息时需要稳定公开标识，不能用随机UUID掩盖歧义。历史读取期间不调整公开列表/身份属性，详见[身份约束](configuration.md#身份约束)。

开发者在源码检出中可用CFSM `pnpm verify:live`和Komari `node --import tsx scripts/verify-komari.ts --origin <实际站点源>`只读检查已启动的对应协议。预编译包和Docker镜像不附带这套开发脚本，普通用户按部署指南检查页面及日志即可；原始诊断输出应保留在私有目录。
