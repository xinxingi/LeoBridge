# CFSM / Komari 双主题商店调查与边界

调查日期：2026-11-02。本文响应新增的长期目标：轻量管理后台发现、安装并切换两个生态的主题，切换不要求修改代码或重新部署。本阶段已按追加授权进入双商店实际交付：目录、纯静态包安装器、管理与协议层分别实现和验收。本文记录目录/安装器的实际证据；安装成功不等于全部主题已兼容，浏览器和云端结果以主验收记录为准。

## 核查材料与证据级别

| 材料 | 本次固定版本 / 来源 | 实际检查 |
| --- | --- | --- |
| CFSM 默认前台及主题服务端 | [609cc0b0998793510453be8eadced2064b28ad7d](https://github.com/huilang-me/CF-Server-Monitor/tree/609cc0b0998793510453be8eadced2064b28ad7d) | `ThemeStorePanel.vue`、`handlers/theme.js`、`handlers/frontend.js` 源码 |
| CFSM 商店 | [6377a65414a2527bbab1e323348bf715dc51f116](https://github.com/huilang-me/CFSM-Theme-Store/tree/6377a65414a2527bbab1e323348bf715dc51f116) | themes.json、目录树、构建脚本；当前12条 |
| Komari 核心 | [96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f](https://github.com/komari-monitor/komari/tree/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f) | `web/api/admin/theme*.go`、`database/models/theme.go`、`web/public/public.go`、路由及公开RPC/WS源码 |
| Komari 官方商店 | [3f889543f6b839cb2452464e04306253f77791bd](https://github.com/komari-monitor/theme-market/tree/3f889543f6b839cb2452464e04306253f77791bd) | v1.json、README、目录树；当前64条，均有download和sha256 |

调查下载保存在忽略目录 `work/research/`，没有执行其中的安装脚本或主题代码。前一轮下载Adhesive Note v1.0.0 ZIP曾45秒超时；本轮通过用户授权的本机代理7897完整取得官方ZIP并校验摘要，结果见下节。Komari默认主题归档缺少构建产物的旧观察仍成立；本阶段选择有明确许可的Adhesive Note作为独立候选。主控、Token和主控原始数据均未用于公开生态调查或包安装。

## 本阶段实际实现与包证据

`src/themes/catalog.ts`独立解析两个固定官方仓库的目录，并支持显式刷新main到不可变提交；`src/themes/package.ts`只返回静态包对象，不安装依赖、不执行包脚本、不写运行时、不启用主题。管理层传生态、目录ID及用户所见的`catalogRevision`，权威下载URL重新从该不可变官方目录取得；不接受任意用户下载URL。包路径均相对于展示根，入口为`index.html`；内容摘要前32个十六进制字符作为安装ID，完整摘要保留。

| 主题 | 实际材料与检查 | 本轮纯安装器结果 |
| --- | --- | --- |
| CFSM Emerald | 目录id=`emerald`；build固定为`0939eb9d6e7638ea301f9dd18a218eedba2420c2`；逐Git blob SHA-1核验；静态引用、许可证通过 | 真实公开来源完整安装器成功；29文件、1,242,481字节；ID `65cc26d49244e3554b7cbec8ec801894` |
| Komari Adhesive Note | 官方v1.0.0 ZIP 4,300,209字节；SHA-256 `94f69c657413e7b3204cfea0bce94f1ee5deb1f897364664b27367b592d49c80`；286归档条目、展开4,963,079字节；manifest一致 | 已下载真实ZIP的纯解析/校验成功；归一后283静态文件、4,187,365字节；ID `838d58a8c1c7db36e8763add9df65270`；主代理随后完成官方远程校验及管理页实际点击安装，均成功 |

两者返回`compatibility=unverified`。Adhesive官方ZIP与本地适配构建是不同包、不同摘要；本地新增协议适配不能沿用官方ZIP哈希。主代理负责实际安装提交、预览、启用/回退和浏览器验收，不能仅凭上表标记兼容。

Emerald构建分支没有LICENSE，安装器第一次正确拒绝为`LICENSE_REQUIRED`。构建提交消息明确`build dist for v1.2.10`；本轮独立核查同仓库该tag解析到源码提交`c80591198df4d2a0332b86b41e53e42fd341ed99`，其LICENSE为MIT，文件SHA-256为`3c9bd83dabc27cbe9870736c79deb8343c52f021c4acbca5d5156395854c1065`。代码审计表仅将上述**确切build提交**映射到该固定许可证证据；构建分支变化后不会自动沿用。普通管理用户可以点击当前已审计版本安装，无需手工填写哈希；未知版本仍需独立许可核查。

Adhesive ZIP内有MIT LICENSE和THIRD_PARTY.md，均随展示包保留。第三方声明明确字体为SIL OFL 1.1、Twemoji图形为CC-BY 4.0，不能把它们都叫MIT；本地适配前台另补字体许可文本及来源。静态包许可检查是来源记录与再分发许可门槛，不构成对所有第三方版权归属的额外授权。

### 官方目录刷新与安装固定版本

目录源仍只允许CFSM和Komari两个已核实的官方仓库，不新增自定义商店URL。原固定SHA保留为审计基线和旧调用回放方式；管理UI不再被编译时SHA锁住，新主题可通过刷新发现，无需修改代码或重新部署：

```ts
// 管理页默认读取当前官方目录（60秒短缓存）。
const catalog = await fetchCatalog(ecosystem, fetcher, { latest: true });
// 点击“刷新”会绕过已有缓存，再解析官方main的当前提交。
const refreshed = await fetchCatalog(ecosystem, fetcher, { refresh: true });
// 安装按用户刚看到的目录提交重新读取，期间main变化也不会改选另一个版本。
const pkg = await installCatalogTheme(ecosystem, selectedId, {
  fetcher,
  expectedCatalogRevision: catalog.catalogRevision,
});
```

解析先请求官方仓库`commits/main`，只接受40位Git SHA，再从该仓库SHA路径读取JSON；不直接把可变main JSON当不可变来源。相同fetcher/生态的并发目录读取合并，缓存最多60秒；返回`fetchedAt/fromCache`说明取数时刻和缓存状态。显式刷新失败返回错误，不把旧缓存伪装成刷新成功。

`revision`和`expectedCatalogRevision`只接受40位十六进制提交，并被限制到对应官方仓库和固定目录文件；不能传入URL、分支名或另一个仓库。`fetchCatalog(ecosystem, fetcher)`及未传`expectedCatalogRevision`的旧安装调用仍使用原审计基线，不静默改变旧代码行为。`catalogRevision`是现行字段，`pinnedVersion`保留为目录版本兼容别名；包另有自己的固定`pinnedVersion`。目录许可证证据通过`catalogLicenseRevision`注明原审计版本，不能自动给新的索引或主题套用许可证。

Komari所见目录中已含包版本和SHA-256，安装严格使用该revision的值。CFSM目录当前只声明构建branch，因此目录固定不等于提前知道构建commit：安装时再把该branch解析为具体SHA并写入最终包记录；不会把branch字符串冒充不可变版本。

本阶段官方Komari包的远程校验及后台实际安装已由主代理完成；真实首页/详情/历史/实时兼容仍按对应浏览器证据单独确认。

### 安装边界与实际限制

- 只允许HTTPS的`github.com`、`raw.githubusercontent.com`、`api.github.com`、`codeload.github.com`、`release-assets.githubusercontent.com`、`objects.githubusercontent.com`。拒绝凭据URL、非443端口、IP/私网/未知域名；重定向最多4跳，每跳重新验证，不转发主控Token或管理认证。
- 下载体逐块计量，目录最多2MB；ZIP最多16MB、展开最多32MB、单文件8MB、文件数1200、声明压缩比200倍。既检查ZIP中央目录也检查本地头；拒绝多卷、ZIP64、加密、符号链接、特殊文件、路径穿越、编码歧义、重复大小写路径、条目覆盖及CRC错误。
- 先完整检查目录，再用fflate对已审查区间做小块流式解压；实际展开超过声明大小立即失败，不能靠伪造小尺寸绕过压缩炸弹限制。没有直接信任`unzipSync`对第二套目录的解析。
- CFSM只读取构建分支的预构建根文件和assets/flags/os-icons/fonts，固定commit并核对blob长度及Git摘要；不运行任何构建命令。找不到入口、完整树、许可证或资源即失败。
- Komari强制官方目录SHA-256、根清单short/version一致，将dist提升根。root只接受清单、许可/声明、README和预览文件；展示树只接受静态资源类型。raw/redirect配置明确拒绝进入管理面。
- 检查HTML、CSS和JS中可静态解析的资源引用。JS使用Acorn流式tokenizer，不执行代码、不用全局正则把字符串中的`from`误当import，也不构造无界AST。缺块和外部静态资源依赖拒绝；动态拼接的资源仍必须通过真实浏览器验证。
- 自动识别MIT、Apache-2.0、ISC完整文本特征并保留原文/来源/摘要；未知许可证要求审查，缺许可证拒绝。独立证据只允许同仓库raw固定40位commit及已知SHA-256，不将目录许可证套用给主题。

目录`canAttemptInstall`只表示允许尝试校验，`licenseStatus=unverified`和`compatibility=unverified`明确区分尚未核实的状态；真正安装需通过所有门槛。其余目录项没有因两个候选成功而被批量标记兼容。

本轮23项合成目录/包测试通过，涵盖重定向SSRF、凭据URL、流式大小限制、错误形状/重复ID、摘要/清单/许可、ZIP路径/符号链接/CRC/实际展开超限、目录歧义、缺失资源、JS误判回归、固定Git blob、审计许可不跨版本复用、main解析后固定读取、缓存/显式刷新、刷新失败及安装不漂移目录版本。真实ZIP与真实公开CFSM安装证据另存于`work/research/packages/`；合成测试不是其来源证据。

## 实际分发形式

### CFSM

生产发现源是 [themes.json](https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/refs/heads/main/themes.json)，顶层 `{schema:1,themes:[…]}`。本次12项的字段集合为 `id/title/cover/tags/description/url/branch/author`，**没有任何项包含 versions、文件校验和、许可证或协议能力字段**。这里是可缓存的公开静态 JSON，不是有独立兼容性承诺或可用性 SLA 的商店服务。

固定版本 CFSM 的商店 UI 先请求本站 `/theme`（服务端代理上述JSON），失败时直接读取raw源；无预置versions时调用 GitHub commits API，以目录声明的构建branch列出最多10个commit，生成完整 `tree/<SHA>` 主题URL。主题服务端读取该不可变位置的 `index.html` 和 `assets/…`，支持子目录，并给commit资源更长缓存。**不会替主题运行npm build**。有些主题依赖flags、OS图标、字体、地图、CDN脚本或绝对资源路径，需要单独资产审计；不能只验证index.html存在。

发现一处材料不一致：同一商店提交的 `scripts/build-themes.sh` 仍要求每项 `.versions[]`，并会安装依赖及构建；当前目录12项均无versions，实际CFSM消费端已支持repo+branch。该脚本不能作为当前可用包接口，也不应由桥接器执行。目录branch应在安装时解析为完整commit并固定，不能每次访问追随main/build。

CFSM核心和商店仓库标识MIT；这不自动赋予每个主题、截图、字体和IP角色资源MIT授权。条目仓库和具体版本许可证必须独立读取、留存。

### Komari

生产发现源是 [v1.json](https://raw.githubusercontent.com/komari-monitor/theme-market/main/v1.json)，当前 `{schema,updated_at,themes:[…]}`。条目为 `name/short/description/version/author/url/preview/download/sha256`；name/description/author可为多语言对象。README明确包由作者托管，GitHub及非GitHub来源均可；没有包的条目可同时省略download和sha256。

固定核心实现也接受顶层数组或单个主题对象，但LeoBridge的官方源解析器应先严格支持文档的版本化形状。核心将download和sha256同时存在视为**可安装**，下载后校验ZIP SHA-256，检查根manifest的short/version与目录匹配。SHA-256只能证明拿到目录指定字节，不能证明作者身份、无恶意代码或协议兼容；当前目录没有签名或统一能力矩阵。

包是ZIP：根 `komari-theme.json`，默认页面 `dist/index.html`，资源可以通过 `/themes/:id/*path` 访问。manifest字段为name、short、description、version、author、url、preview、configuration。configuration有managed/raw/redirect，managed声明string/number/select/switch等设置项；raw是管理配置HTML，redirect指向站内路径。**raw配置HTML不能放进LeoBridge可信管理源执行。** 初版可仅支持经过验证的managed子集，其他类型显示不支持理由。

核心有 `/api/admin/theme/market/sources|catalog|install` 等管理员接口，但这是部署实例内部的管理API，不能当成公共商店API，也无需运行Komari后端来复用目录。Komari核心MIT；本次商店固定目录树未列出LICENSE，目录及每个主题的授权需要分别记录，不能套用核心许可证。

## 必须分开的三个状态

| 层 | 判定 | UI表达及持久记录 |
| --- | --- | --- |
| 发现 | 目录成功读取、schema验证和标识无歧义 | `已发现`，来源、目录revision、版本；读取失败显示旧缓存时间，不冒充最新 |
| 安装 | 包定位成功、完整下载、摘要/路径/配额/manifest检查、许可证已记录，资产全部写入不可变版本 | `已安装`或具体失败；安装不等于启用，不自动升级 |
| 兼容 | 声明的协议profile被桥接支持，必需能力满足，选定包digest通过首页/详情/历史/实时真实浏览器验收 | `已验证兼容` / `部分兼容（列出缺项）` / `未验证` / `不支持`；记录bridge版本、主题digest、验收结果 |

目录的短名称只在对应来源/生态内有意义。内部安装键至少包含`ecosystem + sourceId + themeId + immutableRevision/digest`；不能用数组位置或仅主题名称全局去重。原始主题元数据和验证状态不相互覆盖。

## 协议边界：Komari是另一套输出适配

两类主题都可消费妙妙屋X，但不能把CFSM JSON改路径冒充Komari。现有统一模型保持上游事实和缺省/零/离线/过期/故障语义；在它之上分别实现CFSM和Komari协议模块（当前新增`komari-service.ts`、`komari-realtime.ts`及独立模型输出）。主题包管理只选择已注册的协议profile，不接触探针Token，也不实现采集、远程控制或上游管理。

固定Komari公开消费者契约包括 `/api/nodes`、`/api/public`、`/api/me`、`/api/version`、`/api/recent/:uuid`、`/api/records/load`、`/api/records/ping`、`/api/task/ping`，并存在 `/api/rpc2` 公开JSON-RPC方法。`/api/clients`是WS，客户端发送文本`get`或`get <uuid>`，服务端回复 `{status:'success',data:{online:[uuid],data:{uuid:report}}}`；这与CFSM订阅及batchUpdate结构不同。是否需要全部这些接口必须由选定主题实际调用确认，不实现无关管理/Agent RPC。

源码还发现Komari WS会把CPU usage真0改成0.01。LeoBridge不能照搬此行为；应保留真0，必要时调整选定主题并记录偏差。协议profile必须标明固定版本，不能把本次最新源码推断为全部既有主题的接口版本。后续应先选定一个有明确许可的Komari主题固定版本，审计请求及单位，再做独立浏览器验收。

## 最小动态切换架构建议

此部分保留最初调查建议；当前权威选择见ADR 001和实际ThemeStore实现。Node文件存储与Worker静态资产/R2、DO控制面分别接入，云端部署仍待授权及验收，不能用接口存在冒充云端通过。

1. `CatalogSource`：内置两个已核实官方仓库，按生态独立解析、限制响应大小、记录main解析出的提交及抓取时刻。安装时固定目录revision及包revision；自定义源后续单独授权与限制，不能让主题目录获得任意服务端fetch能力。
2. `ThemePackage`：只接收预构建静态包；不在Worker或可信后台运行npm脚本。CFSM从固定Git tree收集构建资产，Komari按目录摘要取ZIP。验证路径穿越、绝对路径、符号链接、解压总量/单文件/数量/压缩比、MIME、入口及动态import资源。设小于上游100MiB/512MiB限额的可控Worker安装上限；超限明确拒绝或交给可信本地打包导入流程。
3. `ThemeInstallation`：R2存`packages/<digest>/<path>`不可变资源和manifest。安装完整校验后才写ready标记。管理列表、配置schema、能力与验收证据是小元数据，不需要采集历史数据库。
4. `ActiveTheme`：小指针包含installationId、协议profile和generation。初步调查考虑过R2条件写；本阶段按ADR 001选择**单站点控制面DO**串行化安装元数据、启用/回退及会话状态，Node使用对应文件存储实现。所有资产完整写入后才提交元数据；generation冲突返回失败，不覆盖别人操作。DO服务于发布事务，不保存全部历史或实时指标。
5. 访客HTML应不长缓存；从同一已读generation生成不可变资源URL，资源可长缓存。旧版本保留到旧会话/缓存过期，禁止切换后立即删除旧chunk；Cache API按包digest缓存，避免相同`/assets/app.js`在版本间碰撞。每个请求获得一个完整版本，全球边缘在短TTL内可能看到不同完整generation；这不等同“全球同时切换”。
6. KV适合商店缓存或非关键展示元数据；其最终一致性不适合作为要求立即确认的发布锁/权威活动指针。Workers Static Assets绑定适合内置默认主题，运行时新增任意包不应通过重新构建该绑定实现；动态包走R2+Worker。
7. 主题选中不应改变上游数据模型或访问控制。CFSM/Komari公开协议可以并存，旧打开标签页不因选中新主题立即收到另一套schema。若协议路径冲突或主题强依赖绝对`/assets`路径，需要按主题版本分配隔离展示origin或明确可验证的路径适配；不能盲目正则改所有压缩JS。

成本控制依据：R2按存储字节及读写操作计量，资产数量决定安装写次数；CDN/Cache API命中可降低对象读取，但不能作为持久安装仓库。KV读写另计量；DO增加请求与运行/存储成本，故只在控制面事务需求明确后使用。目录刷新按管理员需求或合理TTL，不按访客每次加载刷新GitHub。无需为单个活动指针引入D1，也不在未确定站点流量前承诺免费额度或固定账单。具体限额/价格应在实际部署前核对所选Cloudflare计划，本次未做云端成本测量。

## 可信管理面与第三方主题隔离

建议管理站`admin.example`与展示站`monitor.example`为不同origin；仅不同路径不足以隔离第三方JS。管理员会话cookie使用host-only、Secure、HttpOnly、SameSite，禁止父域Domain；管理API只接受明确管理origin与验证过的登录态，对变更请求执行CSRF/Origin校验，不用GET执行安装/切换。若使用Cloudflare Access，应在Worker验证Access JWT受众/签名，不能只检查某个可伪造请求头。管理登录不授予主题浏览器主控Token，秘密使用独立写入/轮换接口且读API只返回是否已设置。

主题默认是可执行第三方JavaScript：管理页不能内联其raw配置HTML、直接以v-html显示不可信说明，也不能使用同源预览iframe。预览使用独立origin/严格sandbox；主题自定义脚本、外部CDN、service worker注册都必须进入包审计，不能拥有管理源作用域。公开站即使允许主题脚本，也只能访问已授权展示的数据；私有站访问控制独立于上游Token保护。服务端包下载限定允许的公开主机、协议、端口及重定向，拒绝凭据URL、本机/私网/元数据目标，所有跳转重新验证；日志不含主控秘密。

## 本阶段验收衔接及后续范围

- 固定CFSM默认前台的既有验收记录保留，双商店改动后由主代理统一回归。
- 两个官方目录的独立解析、无需部署的刷新及静态安装器已实现；管理页发现、安装和状态呈现须实际浏览器验收，不承诺目录所有项兼容。
- 管理层接入不可变包存储、独立登录、预览/启用/回退及并发/失败测试；本轮额外CFSM候选为已完成纯静态安装的Emerald固定版本。
- Komari协议profile与Adhesive Note固定来源的本地适配由独立模块实现，最终首页/详情/历史/实时仍需主代理浏览器验收；官方原包不自动继承适配版兼容结果。
- 双商店和管理面需要额外R2、域名/Access及部署目标时，在本地可审查成果准备后再申请相应部署权限。
