# 排障

不要粘贴`.dev.vars`、主题存储中的会话或原始响应到工单/日志。真实只读复验使用CFSM `pnpm verify:live`及Komari `scripts/verify-komari.ts --origin <实际版本源>`；原始证据仅在忽略目录。安装成功、HTTP 200、WebSocket open与真实主题完整兼容是不同检查。

## 启动、入口与管理

| 现象/错误码 | 检查与行为 |
| --- | --- |
| Theme initialization failed / 缺资源 | 从仓库根运行`pnpm install --frozen-lockfile`和`pnpm build`；构建同时生成两套前台及`dist/bundled`，不能只复制旧`dist/public` |
| 版本地址无法解析 | 浏览器需支持`*.localhost`回环解析；保留管理站生成的`t-<ID>.display.localhost`或`p-<ID>.preview.localhost`主机名，改成IP会改变路由 |
| 根入口307 | 正常跳转到当前安装版本，API脚本须选择实际版本源；旧页面继续使用旧协议，刷新根入口才跟随新主题 |
| 改PORT后404 / Bad host | `PORT`仅影响默认展示源；核对管理、展示、预览origin的scheme/host/port与监听器一致。Worker默认三类主机共用8787 |
| Node配置https源后404 | 当前Node本地监听使用HTTP且按HTTP构造请求；勿直接当作生产TLS反代方案，远程部署使用Worker HTTPS源 |
| ADMIN_NOT_CONFIGURED / 503 | 运行`pnpm configure:admin`，从本机私有`.dev.vars`读取独立管理凭据；不输出密码，不重复生成 |
| LOGIN_FAILED / LOGIN_THROTTLED | 使用管理凭据而非探针Token或展示密码；连续失败会限速，等待后核对本机私有配置 |
| LOGIN_REQUIRED / 401 | 会话过期或已退出，回管理源重新登录；展示/预览不会携带管理cookie |
| ORIGIN_ISOLATION / MANAGEMENT_CONFIGURATION | 后台、展示、预览须不同主机名；不能仅分端口或路径。远程源使用HTTPS，检查是否包含多余路径、斜线或用户信息 |
| ORIGIN_REJECTED / CSRF_REJECTED | 从配置的管理源操作，重新登录获取会话与CSRF；不要关闭校验或将管理页面代理到主题主机 |
| REVISION_CONFLICT / 409 | 另一页面已改变安装或启用状态；刷新管理站，检查当前/上一版本后重新操作 |
| PREVIEW_REQUIRED / 409 | 商店包未经实测，先预览再明确确认；确认启用不会自动把兼容状态变成verified |
| STORE_BUSY / 503 | 另一Node进程正在写主题状态。若异常退出遗留`work/theme-store/state.lock`，先确认所有使用该目录的进程已停止、备份状态，再移除遗留锁；不可在仍有写入者时删除锁 |
| STORAGE_CONFIGURATION / 503 | Worker缺少`THEME_ASSETS` R2或`THEME_COORDINATOR` DO绑定；本地模拟与云端资源分别配置 |

Node状态在`work/theme-store`，包括安装资源和管理会话；不要提交、随意删除或与不同站点共享。安装先写资源再发布元数据，失败可能留下未发布资源，当前无卸载/自动清理UI；不要为释放空间直接删除active/previous或仍有旧页面访问的资源。

## 商店与主题包

| 现象/错误码 | 检查与行为 |
| --- | --- |
| 商店暂未更新 | 通常缓存60秒；刷新按钮重新解析官方main并固定到SHA。刷新失败会显示失败，不冒充新目录成功 |
| CATALOG_REVISION | 刷新目录再选主题；安装提交用户所见revision，不能省略或改用任意URL |
| LICENSE_REQUIRED / LICENSE_REVIEW_REQUIRED | 固定版本没有可核实且受支持许可证；不能推断“公开GitHub即许可”。独立证据需同仓库固定版本及摘要审查 |
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
| CONFIGURATION | 上游必须为origin；检查展示访问策略及独立密码，不输出值 |
| IDENTITY_CONFLICT / 409 | 核对改名、隐藏属性、增删节点、重复匹配；保留原id审查match，不能把下标当id |
| IDENTITY_CHANGED / 409 | 历史期间公开列表顺序变化，结果已丢弃；列表稳定后再读。前后校验不能消除短暂重排再复原的竞态 |
| UPSTREAM_HTTP / 502 | 上游HTTP失败；保护开启而Token缺失可能404。核对服务端密钥，不关闭保护排障 |
| UPSTREAM_TIMEOUT / 504 | 握手或读取超时，检查授权网络与源站并只读重试；不能认定服务器离线 |
| curl代理成功但Node/WS仍失败 | Node需显式配置`BRIDGE_DEV_PROXY`接入HTTP和WS Agent并重启；不能据curl成功认定后端已使用代理 |
| Wrangler有代理提示但workerd超时 | CLI代理不代表workerd出站；本次环境变量方式实测仍504。使用Node已验证代理路径，本地模拟与云端真实链路分开验收 |
| UPSTREAM_UNAVAILABLE / 502 | DNS/TLS/连接中断；不改主控配置或把Token/源地址放进浏览器查询参数 |
| PROBE_DISABLED / 503 | 源端未开放探针，清除旧展示；不能用空列表冒充成功 |
| HISTORY_RANGE / UPSTREAM_HISTORY | 范围不支持、success=false或历史契约变化；七天需`history_days>=7`及实际协议支持，不补0或造曲线 |
| 数据过期、实时重连 | WS连接建立不等于新采样；看观察时间、transport和恢复。HTTP回退不是原生WS实时验证 |
| “—”或空图 | 未提供/未验证能力不等于0；计费和网卡流量不混用，显式8目标选择不等于源端全目标 |
| private展示401 | 使用独立展示Basic Auth；上游Token和管理员cookie均不能登录展示站。版本和预览是不同源，浏览器可能分别提示 |
| Worker出站/WS失败 | 分别检查本地workerd和云运行时，dry-run不验证Cloudflare网络、TLS、域名路由或额度 |

绑定初始化仅用于尚无绑定配置。修复时保留私有`.dev.vars`和稳定ID，不自动重生成。源端没有足够的公开辨识信息时需要稳定公开标识，不能用随机UUID掩盖歧义。历史读取期间不调整公开列表/身份属性，详见README。
