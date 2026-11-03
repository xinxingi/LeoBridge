# 配置参考

## 首次使用

新安装无需预先填写主控地址、Token或节点JSON。先按[运行包](deployment/local.md)、[Docker](deployment/docker.md)或[源码开发](development/build.md)指南启动，再打开管理后台（默认 `http://127.0.0.1:8787/admin/`）：

1. **选择正确的登录凭据。** 全新状态且未自定义账号时，用 `admin` / `admin`；按提示设置12–128位、含大小写字母、数字和符号的新密码，再重新登录。管理用户名可由 `BRIDGE_ADMIN_USERNAME` 修改；密码不从环境读取。已有实例使用当前密码，重启或升级不恢复初始密码。
2. **在“数据源设置”连接主控。** 填写地址与探针Token，点击“检查连接”，核对节点身份和Ping目标，勾选确认后点击“保存并应用”。只检查成功不等于已保存。
3. **安装并启用主题。** 在商店查看来源和许可，确认安装，预览后启用。启动时没有主题属于正常状态。

日后修改管理密码使用后台“修改密码”，更换主控或Token使用“数据源设置”。这些操作保存成功后立即生效，不用编辑配置文件或重启。密码保存成功会退出旧会话；失败时旧密码不变。

## 配置在哪里修改和保存

[本地.dev.vars示例](../.dev.vars.example)与[Docker.env示例](../deploy/docker/.env.example)只保留端口、用户名、标题、存储路径等每次启动生效的运行参数。管理密码与数据源统一保存在状态文件中，只通过后台修改。

| 修改运行参数后 | 生效操作 |
| --- | --- |
| 源码开发的`.dev.vars` | Ctrl+C停止，再执行`pnpm dev` |
| 运行包的`.dev.vars` | `./leobridge.sh restart` |
| Docker的`.env` | `docker compose up -d`重新创建容器；`restart`不更新环境 |

切换`BRIDGE_THEME_STORE`目录或`THEME_STORE_VOLUME`卷名不会迁移数据。继续使用原密码、数据源和主题时，应保留原存储位置，或停机后完整迁移。

**后台不会回写 `.dev.vars` 或 Docker 的 `.env`。文件未变化不代表保存失败；密码和数据源不从运行配置文件读取。** 按下表选择修改入口：

| 要修改什么 | 修改入口 | 实际生效规则 |
| --- | --- | --- |
| 管理用户名 | `BRIDGE_ADMIN_USERNAME`，默认admin | 每次启动读取；后台目前不能改用户名 |
| 当前管理密码 | 后台“修改密码” | 只读取状态目录里的密码摘要；重启不会重置密码 |
| 主控地址、Token、节点身份、Ping目标 | 后台“数据源设置” | 整套保存到与密码相同的state.json，立即生效；没有环境变量回退 |
| 商店目录及主题下载代理 | 后台“商店下载设置” | 保存后用于后续商店请求，重启后保留；不改变主控 HTTP/WS 连接 |
| 端口、监听地址、访问策略、开发代理、状态目录路径 | 启动环境或配置文件 | 重启后读取；Docker修改.env后须重新创建容器，单纯restart不更新容器环境 |

全新状态使用默认密码admin并强制改密。尚未保存数据源时，前台显示配置引导，后台可以正常使用；不会读取旧环境配置。

| 运行方式 | 启动配置从哪里读取 | 后台状态保存在哪里 |
| --- | --- | --- |
| 源码开发 `pnpm dev` | 项目根目录的可选 `.dev.vars`；终端环境变量覆盖同名文件项 | 默认项目内 `work/theme-store/state.json` |
| 预编译运行包，默认local模式 | 解压目录的可选 `.dev.vars`；环境变量优先 | 默认解压目录内 `work/theme-store/state.json` |
| Docker Compose模板 | 部署目录的 `.env` 经Compose传入容器；不读取宿主项目的 `.dev.vars` | 命名卷内 `/data/theme-store/state.json`，默认卷名 `leobridge-theme-store` |

Node可用 `BRIDGE_THEME_STORE`更改状态目录，`BRIDGE_ENV_FILE`指定私有配置文件；direct/proxy模式默认不读取 `.dev.vars`。后台密码以加盐摘要保存，无法从文件还原明文；数据源Token需要供服务端使用，并非密码摘要。状态目录还包含已安装主题及会话，备份应保存整个目录或卷，不能靠删除它来重置密码。

### 旧版本配置迁移

旧版的 `BRIDGE_ADMIN_PASSWORD`、`MMWX_BASE_URL`、`MMWX_PROBE_TOKEN`、`BRIDGE_BINDINGS`、`BRIDGE_PING_TARGETS` 已移除，遗留值不会参与登录或连接。已保存的密码摘要、数据源和稳定ID保持有效。升级前若数据源仅在环境中配置，请先在旧版后台检查并保存，核对节点沿用原ID，再移除文件中的旧变量；不要删除状态目录。旧的 `configure` 和 `configure:admin` 初始化命令已移除。

“数据源设置”显示已保存的地址、节点数和Token状态，修改时同一主控留空Token会沿用保存值。更换主控必须填写新Token并重新核对节点身份。

## 商店下载代理

Node及Docker后台提供“商店下载设置”：打开“通过代理访问主题商店”，填写HTTP/HTTPS代理地址并保存，例如`http://127.0.0.1:7897`。支持带用户名和密码的代理URL；认证信息只在服务端保存，重新打开页面只显示去掉认证信息的地址。地址留空保留原地址及认证信息；填写新地址则完整替换。当前不支持SOCKS地址。

此设置覆盖CFSM和Komari目录、版本解析、许可文件及主题包的全部下载请求。保存后新任务使用新设置，正在下载的任务仍完成于原代理；代理失败会报错，不回退直连。关闭并保存后，商店明确使用直连。它不修改数据源的HTTP/WS代理，也不是站点反向代理配置。

代理地址必须能从运行LeoBridge的机器访问：VPS的`127.0.0.1`指VPS，Docker内则指容器自身。Docker访问宿主代理时使用容器可达的宿主地址；Docker Desktop通常可使用`host.docker.internal`，Linux需按实际网络配置宿主网关。

配置保存在现有状态目录/卷中，使用独立版本号防止旧页面覆盖。默认关闭，未在后台开启并保存时明确直连，不继承`BRIDGE_DEV_PROXY`。后台保存后以保存值为准，关闭代理也不会回退到该环境变量。Worker当前不支持此代理设置，界面会明确说明；移入启用代理的状态也会拒绝下载，不能绕过代理直连。保存设置不等于代理连通性验证，打开商店会实际请求目录并显示结果。

## 后台配置数据源

新实例没有上游配置也能启动。打开 `/admin/`，登录后（默认密码须先改密），在“数据源设置”填写主控 origin 和探针 Token。检查连接只读取公开探针快照；核对每台节点的稳定身份和最多8个 Ping 目标后，勾选确认并保存。保存前重新读取快照校验一一对应关系，失败不会替换当前配置。

未变更的已有节点沿用原ID；改名或更换主控时，在每台节点的下拉框明确选择旧身份或新建身份。未再选择的旧身份会移除；完全相同的公开描述无法安全区分时拒绝保存。名称隐藏时不在检查页面返回名称。空公开列表可以明确确认保存，不伪造节点。

Token 不在任何管理响应或主题响应中回显。同一主控留空保留原 Token；更换主控时不会携带旧 Token。地址、Token、绑定和 Ping 目标只从持久化状态读取，重启保留。Node 将这些秘密保存在状态目录的 `state.json`（文件权限0600），备份需按凭据保护；Workers 沿用私有 DO 状态存储，云端尚未验收。

配置保存使用独立版本号防止并发覆盖，需要有效管理会话、默认密码完成改密、Origin与CSRF校验。保存后重建两个协议的数据源及缓存，关闭本进程旧实时连接；迟到HTTP结果和旧版本实时帧被拒绝。其他Worker实例在后续请求/实时输出时检查版本。网络监听、域名/TLS和展示访问策略仍由部署参数配置。

## 配置与访问控制

| 变量 | 含义 |
| --- | --- |
| `BRIDGE_ACCESS` | 默认`local`，仅localhost及其子域/127.0.0.1；远程显式选`public`或`private` |
| `BRIDGE_USERNAME` / `BRIDGE_PASSWORD` | private展示站独立Basic Auth，密码至少16字符；远程必须HTTPS |
| `BRIDGE_TITLE` | 展示站名称，默认LeoBridge |
| `BRIDGE_ADMIN_USERNAME` | 当前管理用户名，默认admin，每次启动读取 |
| `BRIDGE_ROUTING` | 新配置默认`single`：同端口 `/` 展示、`/admin/` 管理；`isolated` 保留独立源模式。未指定时，旧配置中的管理源、版本域或预览源会自动选择isolated |
| `BRIDGE_ORIGIN` | single模式的规范站点源，默认`http://127.0.0.1:8787`；临时公网HTTP需显式direct模式 |
| `BRIDGE_ADMIN_ORIGIN` | isolated模式管理源，默认`http://admin.localhost:8786`；single使用BRIDGE_ORIGIN |
| `BRIDGE_DISPLAY_ORIGIN` / `BRIDGE_DISPLAY_DOMAIN` | 展示根源和旧版本子域后缀；默认single预览无需子域，Node默认`http://127.0.0.1:8787`及`display.localhost` |
| `BRIDGE_PREVIEW_ORIGIN` | isolated预览子域基源，默认`http://preview.localhost:8789`；single预览使用BRIDGE_ORIGIN及版本参数，无需设置此项 |
| `BRIDGE_THEME_STORE` | Node主题、数据源凭据与管理会话存储目录，默认`work/theme-store`；不提交该目录 |
| `PORT` | 未显式配置站点源时的Node单端口，默认8787；旧isolated模式不改变管理/预览端口 |
| `BRIDGE_DEV_PROXY` | 可选Node开发HTTP CONNECT代理，例如本机已核实的`http://127.0.0.1:7897`；用于数据源HTTP和WS；商店下载代理独立且默认关闭，Worker不读取 |

主题由管理站保存的active安装指针选择，旧的`BRIDGE_THEME`不用于动态主题选择。上游Token只保护主控，**不自动保护展示站**。public展示所选探针公开数据；private保护主题HTML、资源、HTTP与WS。local仅适合本机运行，不应通过隧道冒充localhost公开服务。

默认single模式在同一站点提供探针和管理界面，管理API位于`/admin/api/`。会话Cookie为host-only、HttpOnly、SameSite=Strict，限定`Path=/admin`；HTTPS使用Secure及`__Secure-`前缀。写操作继续检查Origin与CSRF，退出撤销服务端会话。**同源路径不构成主题与后台的安全隔离，只应预览和启用可信主题**。需要运行不可信第三方主题时，选择isolated并使用不同管理、展示、预览主机名；此模式保留`__Host-`管理Cookie和版本主机路由。private展示凭据与管理登录分别配置。

## 身份约束

妙妙屋公开接口没有不可变ID，历史查询使用当前数组下标。桥接器不把下标或名称当永久ID：

- 每个桥接ID有显式选择条件；每次快照必须完整且一对一匹配。重名可用其他公开属性区分，无法区分即409。
- 正常重排保持桥接ID；历史查询前后各取新快照，若整组顺序改变则丢弃结果并返回409。
- 改名、可辨识字段变化、隐藏字段、添加/移除服务器需要审查绑定；不会静默换到另一台。保持原id并编辑match，不能重新生成全部UUID来“解决”。
- 源端在两次快照之间重排又复原，或另一台机器完全复用同组描述属性，当前API无法识别。运行要求**历史读取期间不调整公开列表/身份属性**；若不能满足，需要上游提供稳定公开ID及按ID查询接口。前后检查不是原子身份保证。

## 协议与数据语义

CFSM版本站提供`/api/config`、`/api/servers`、`/api/server?id=…`、`/api/history/all?id=…&hours=…`、`/api/ws`；静态资源由各安装包提供。Komari版本站提供JSON-RPC 2.0 `POST /api/rpc2`及同路径WebSocket，包含节点、公开设置、最新状态、近期观察、系统历史与Ping历史所需方法，并提供有限只读REST兼容。协议按安装版本选择，不把CFSM JSON直接交给Komari。single根站的`/admin`提供管理；版本/预览站拒绝`/admin`和`/manage`；管理接口用于主题和桥接数据源配置，不包含主控服务器管理或远程控制。

- 统一模型采用byte、B/s、百分比；CFSM容量转MiB，速度仍B/s；Komari接收字节，主题自行格式化。缺失为未知值，实际0保留；上游故障、过期和服务器离线分开。在线时间戳是桥接观察时间，启动时间由uptime推算。
- 系统及Ping真实支持1h/6h/24h/7d；其他已开放小范围从上一级真实聚合裁剪。七天依据`history_days`及真实`range=7d`验证，不足七天不补齐。
- 1h/6h/24h/7d源桶宽为300/600/1800/7200秒，小范围不会提高源精度。Ping -1为无数据，明确100%丢包且无有效RTT才可表示超时。未采样不造点，历史容量不拿当前值回填。
- boot/计费/网卡累计口径不混用；累计/月流量、计费、Swap、GPU、磁盘IO、进程数等未确认能力不填造，协议返回未知或明确不支持；商店主题如何显示需单独验收。
- 源端Ping目标数量可变，显式配置最多8个；未选目标不展示，不能声称全目标兼容。

## 实时、缓存与故障

快照缓存3秒并合并并发；历史缓存30秒、最多100项，命中后仍校验身份。源HTTP总预算30秒，收到响应头前的传输失败最多重试一次，HTTP错误/响应体失败不重试；历史前后校验使客户端预算为110秒。缓存revision防止迟到HTTP覆盖名称隐藏、移除服务器或关闭探针等新策略。单访客WS断线不清空其他协议的有效缓存或中断其历史查询；源数据无效和身份冲突仍使旧状态失效。失败不伪造成功或为旧数据重标采样时间。

CFSM实时订阅和Komari RPC实时请求各自管理协议生命周期；关闭页面释放连接和定时器。CFSM上游重连1至30秒退避，45秒无新帧标过期并重连，10分钟更新连接。本次原生完整帧曾约31秒，不能承诺每5秒到达；15秒无完整帧时每5秒检查并通过共享HTTP缓存回退，成功才发真实观察，恢复后停止轮询。历史验收的Komari适配包每5秒读取最新状态并根据源观察时间去重；商店原包的轮询行为由各主题决定。WebSocket open或HTTP回退均不等于原生WS新采样已验证。

Node最多50个访客实时连接；Workers无跨isolate共享限流，DO保存管理状态事务及私有数据源配置。适用于小规模监控，公开高流量站需先评估连接、请求、CPU和费用。

`BRIDGE_DEV_PROXY`用于Node开发环境的HTTP与WebSocket代理。Wrangler CLI使用代理不代表workerd出站使用同一代理；需要本机代理时使用Node。生产环境应配置目标机器可访问的网络，不要沿用开发机的127.0.0.1代理地址。


## Node运行参数

源码开发使用`pnpm dev`前台运行，修改监听或环境配置后按Ctrl+C停止并重新运行，准备步骤见[开发构建](development/build.md)。无需创建`.dev.vars`即可使用默认本地配置启动；需要调整时参考[开发配置示例](../.dev.vars.example)，已有私有文件直接编辑。

预编译运行包使用`./leobridge.sh start`后台运行，修改配置后用`./leobridge.sh restart`生效，完整命令见[本地部署](deployment/local.md)。脚本以运行包根目录解析相对路径，不保存启动命令里的临时环境变量；需要重启后沿用的参数请放在私有配置文件中。

| 参数 | 行为 |
| --- | --- |
| `BRIDGE_NODE_MODE` | 默认local；proxy为HTTPS反代；direct用于明确配置的HTTP访问（Docker默认回环端口），必须single、显式public/private |
| `BRIDGE_LISTEN_HOST` | 默认127.0.0.1；direct/proxy容器可设0.0.0.0，local只允许回环 |
| `BRIDGE_LISTEN_PORT` | single只监听此端口；仅旧local+isolated按三个origin端口监听 |
| `BRIDGE_TRUSTED_PROXIES` | 代理IP/CIDR逗号列表，默认127.0.0.1/32,::1/128；Docker默认direct不信任转发身份头；接入自有反代时填写应用实际看到的代理IP |
| `BRIDGE_ENV_FILE` | 显式私有Node dotenv路径；环境变量优先。proxy/direct默认不读.dev.vars，路径错误拒绝启动 |
| `BRIDGE_ASSETS_DIR` | 内置资源目录，默认dist/bundled；不是主题状态目录 |

域名解析由部署者在DNS服务商处配置，域名对应的站点反代、HTTPS终止、证书及续期交给nginx或Caddy。LeoBridge只监听HTTP端口；origin配置用于来源校验和链接生成，不用于管理域名或证书。反向代理需保留Host、Origin、Cookie及WebSocket升级头。

proxy要求三个origin全部HTTPS，并拒绝BRIDGE_DEV_PROXY。Host必须匹配配置范围；Forwarded和X-Forwarded-Host不用于生成站点地址。只有受信任代理的单一X-Forwarded-Proto=https和单IP X-Real-IP有效。HTTP与WS一致校验，客户端伪造CF-Connecting-IP无法绕过登录节流。

Docker的.env由Compose解析并传环境，本地部署的私有dotenv文件由Node解析；不要将两个不同用途的文件直接互换。不要同时让多个解析器重复解释引号和JSON。完整示例见[Docker部署](deployment/docker.md)。

## 管理密码持久化

使用默认密码`admin`首次登录时，只能查看会话、修改密码或退出。新密码要求12–128位、包含大小写英文字母、数字和符号；拒绝常见弱口令、当前密码和初始密码。保存时校验当前密码及两次新密码一致性。改密撤销所有会话，需要重新登录；以后可在管理页点击“修改密码”。

Node将随机盐和PBKDF2-SHA256摘要（600,000次）写入状态目录的 `state.json`，不保存新密码明文，公开状态API排除凭据和会话。备份和迁移必须包含整个状态目录；删除状态目录会同时丢失主题管理状态和已更改的密码，不能作为常规改密方法。已有密码摘要继续有效，不受环境变量影响。后台改密不会回写`.dev.vars`或其他环境配置文件。用户名仍由`BRIDGE_ADMIN_USERNAME`配置。

single模式根入口直接提供当前主题资源，不跳转版本域；根资源禁用长期缓存。启用/回退主题时关闭根入口旧实时连接，刷新后使用新协议。single预览使用同域名的`?__preview=<安装ID>`，HTTP/WS按请求选择版本，不改变正式站或其他标签页；只需反代一个域名到同一端口，见[单域名反代](deployment/reverse-proxy.md)。isolated及旧版本/预览主机仍绑定安装版本，独立域名需另配DNS、证书和反代。direct校验配置的精确Host，不信任转发身份头；建议正式部署使用HTTPS的proxy模式。
