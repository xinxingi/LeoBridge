# 配置参考

## 配置与访问控制

| 变量 | 含义 |
| --- | --- |
| `MMWX_BASE_URL` | 固定HTTP(S) origin，不允许账号、路径、查询参数和重定向；建议HTTPS |
| `MMWX_PROBE_TOKEN` | 仅服务端，通过`X-MMwx-Probe-Token`访问主控 |
| `BRIDGE_ACCESS` | 默认`local`，仅localhost及其子域/127.0.0.1；远程显式选`public`或`private` |
| `BRIDGE_USERNAME` / `BRIDGE_PASSWORD` | private展示站独立Basic Auth，密码至少16字符；远程必须HTTPS |
| `BRIDGE_TITLE` | 展示站名称，默认LeoBridge |
| `BRIDGE_BINDINGS` | 服务端JSON数组`{id, match:{…}}`，初始化后显式维护 |
| `BRIDGE_PING_TARGETS` | CFSM槽位映射`{ct:{key,label}, …}`，最多8个固定目标，Komari也使用该选择集 |
| `BRIDGE_ADMIN_USERNAME` / `BRIDGE_ADMIN_PASSWORD` | 初始管理凭据，默认 `admin` / `admin`；自定义初始密码至少20字符。首次登录强制改密，改密后环境变量密码不再用于登录；独立于上游Token和展示密码 |
| `BRIDGE_ADMIN_ORIGIN` | 管理源，Node默认`http://admin.localhost:8786` |
| `BRIDGE_DISPLAY_ORIGIN` / `BRIDGE_DISPLAY_DOMAIN` | 展示根源和版本子域后缀，Node默认`http://127.0.0.1:8787`及`display.localhost` |
| `BRIDGE_PREVIEW_ORIGIN` | 预览子域基源，Node默认`http://preview.localhost:8789` |
| `BRIDGE_THEME_STORE` | Node主题与管理会话存储目录，默认`work/theme-store`；不提交该目录 |
| `PORT` | 未显式配置展示源时的Node展示端口，默认8787；不会同步改变管理或预览端口 |
| `BRIDGE_DEV_PROXY` | 可选Node开发HTTP CONNECT代理，例如本机已核实的`http://127.0.0.1:7897`；HTTP和WS均显式接入，Worker不读取 |

主题由管理站保存的active安装指针选择，旧的`BRIDGE_THEME`不用于动态主题选择。上游Token只保护主控，**不自动保护展示站**。public展示所选探针公开数据；private保护主题HTML、资源、HTTP与WS。local仅适合本机运行，不应通过隧道冒充localhost公开服务。

管理员使用独立主机上的host-only、HttpOnly、SameSite=Strict会话Cookie；HTTPS下使用Secure及`__Host-`前缀。本机HTTP使用单独cookie名。写操作同时检查Origin与CSRF，退出会在服务端删除会话。管理、展示和预览必须使用不同主机名，仅分端口或路径不满足隔离。展示/预览不能继承管理登录，也不能用管理员cookie代替private展示凭据。

## 身份约束

妙妙屋公开接口没有不可变ID，历史查询使用当前数组下标。桥接器不把下标或名称当永久ID：

- 每个桥接ID有显式选择条件；每次快照必须完整且一对一匹配。重名可用其他公开属性区分，无法区分即409。
- 正常重排保持桥接ID；历史查询前后各取新快照，若整组顺序改变则丢弃结果并返回409。
- 改名、可辨识字段变化、隐藏字段、添加/移除服务器需要审查绑定；不会静默换到另一台。保持原id并编辑match，不能重新生成全部UUID来“解决”。
- 源端在两次快照之间重排又复原，或另一台机器完全复用同组描述属性，当前API无法识别。运行要求**历史读取期间不调整公开列表/身份属性**；若不能满足，需要上游提供稳定公开ID及按ID查询接口。前后检查不是原子身份保证。

## 协议与数据语义

CFSM版本站提供`/api/config`、`/api/servers`、`/api/server?id=…`、`/api/history/all?id=…&hours=…`、`/api/ws`；默认前台旗帜和系统图标本地构建。Komari版本站提供JSON-RPC 2.0 `POST /api/rpc2`及同路径WebSocket，包含节点、公开设置、最新状态、近期观察、系统历史与Ping历史所需方法，并提供有限只读REST兼容。协议按安装版本选择，不把CFSM JSON直接交给Komari。展示站的`/admin`和`/manage`拒绝访问；管理站另有主题管理接口，不包含上游管理或远程控制。

- 统一模型采用byte、B/s、百分比；CFSM容量转MiB，速度仍B/s；Komari接收字节，主题自行格式化。缺失为未知值，实际0保留；上游故障、过期和服务器离线分开。在线时间戳是桥接观察时间，启动时间由uptime推算。
- 系统及Ping真实支持1h/6h/24h/7d；其他已开放小范围从上一级真实聚合裁剪。七天依据`history_days`及真实`range=7d`验证，不足七天不补齐。
- 1h/6h/24h/7d源桶宽为300/600/1800/7200秒，小范围不会提高源精度。Ping -1为无数据，明确100%丢包且无有效RTT才可表示超时。未采样不造点，历史容量不拿当前值回填。
- boot/计费/网卡累计口径不混用；累计/月流量、计费、Swap、GPU、磁盘IO、进程数等未确认能力不填造，显示“—”或空图。
- 本次源端9个Ping目标，显式配置最多8个；未选目标不展示，不能声称全目标兼容。

## 实时、缓存与故障

快照缓存3秒并合并并发；历史缓存30秒、最多100项，命中后仍校验身份。源HTTP总预算30秒，收到响应头前的传输失败最多重试一次，HTTP错误/响应体失败不重试；历史前后校验使客户端预算为110秒。缓存revision防止迟到HTTP覆盖名称隐藏、移除服务器或关闭探针等新策略。单访客WS断线不清空其他协议的有效缓存或中断其历史查询；源数据无效和身份冲突仍使旧状态失效。失败不伪造成功或为旧数据重标采样时间。

CFSM实时订阅和Komari RPC实时请求各自管理协议生命周期；关闭页面释放连接和定时器。CFSM上游重连1至30秒退避，45秒无新帧标过期并重连，10分钟更新连接。本次原生完整帧曾约31秒，不能承诺每5秒到达；15秒无完整帧时每5秒检查并通过共享HTTP缓存回退，成功才发真实观察，恢复后停止轮询。Komari主题每5秒读取最新状态并根据源观察时间去重。WebSocket open或HTTP回退均不等于原生WS新采样已验证。

Node最多50个访客实时连接；Workers无跨isolate共享限流，DO当前仅用于管理状态事务。适用于小规模监控，公开高流量站需先评估连接、请求、CPU和费用。

`BRIDGE_DEV_PROXY`用于Node开发环境的HTTP与WebSocket代理。Wrangler CLI使用代理不代表workerd出站使用同一代理；需要本机代理时使用Node。生产环境应配置目标机器可访问的网络，不要沿用开发机的127.0.0.1代理地址。


## Node VPS运行参数

| 参数 | 行为 |
| --- | --- |
| `BRIDGE_NODE_MODE` | 默认local；proxy为生产反代模式，必须显式public/private；管理密码首次登录后强制更改 |
| `BRIDGE_LISTEN_HOST` | 默认127.0.0.1；proxy容器可设0.0.0.0，local只允许回环 |
| `BRIDGE_LISTEN_PORT` | proxy单端口，默认8787；local仍按三个origin各自端口监听 |
| `BRIDGE_TRUSTED_PROXIES` | 代理IP/CIDR逗号列表，默认127.0.0.1/32,::1/128；Docker示例只信任nginx固定IP |
| `BRIDGE_ENV_FILE` | 显式私有Node dotenv路径；环境变量优先。proxy默认不读.dev.vars，路径错误拒绝启动 |
| `BRIDGE_ASSETS_DIR` | 内置资源目录，默认dist/bundled；不是主题状态目录 |

proxy要求三个origin全部HTTPS，并拒绝BRIDGE_DEV_PROXY。Host必须匹配配置范围；Forwarded和X-Forwarded-Host不用于生成站点地址。只有受信任代理的单一X-Forwarded-Proto=https和单IP X-Real-IP有效。HTTP与WS一致校验，客户端伪造CF-Connecting-IP无法绕过登录节流。

Docker的.env由Compose解析并传环境，systemd的runtime.env由Node解析；不要将两个不同用途的文件直接互换。不要同时让多个解析器重复解释引号和JSON。完整示例见[VPS部署](deployment/vps.md)。

## 管理密码持久化

首次登录只能查看会话、修改密码或退出，管理API在服务端拒绝其他操作。新密码要求12–128位、包含大小写英文字母、数字和符号；拒绝常见弱口令、当前密码和初始密码。保存时校验当前密码及两次新密码一致性。改密撤销所有会话，需要重新登录；以后可在管理页点击“修改密码”。

Node将随机盐和PBKDF2-SHA256摘要（600,000次）写入状态目录的 `state.json`，不保存新密码明文，公开状态API排除凭据和会话。备份和迁移必须包含整个状态目录；删除状态目录会同时丢失主题管理状态和已更改的密码，不能作为常规改密方法。已有部署在升级后首次登录也需完成一次改密；不重置其自定义初始密码。
