# CFSM / Komari 商店格式

核查日期：2026-11-02。本文保留固定上游目录及包格式的依据；数量和包解析结果只适用于该次采样。当前安装流程见[主题管理](../themes.md)，模块职责见[架构说明](../development/architecture.md)。安装成功不代表主题协议兼容。

## 核查材料与证据级别

| 材料 | 固定版本 / 来源 | 实际检查 |
| --- | --- | --- |
| CFSM 默认前台及主题服务端 | [609cc0b0998793510453be8eadced2064b28ad7d](https://github.com/huilang-me/CF-Server-Monitor/tree/609cc0b0998793510453be8eadced2064b28ad7d) | `ThemeStorePanel.vue`、`handlers/theme.js`、`handlers/frontend.js` 源码 |
| CFSM 商店 | [6377a65414a2527bbab1e323348bf715dc51f116](https://github.com/huilang-me/CFSM-Theme-Store/tree/6377a65414a2527bbab1e323348bf715dc51f116) | themes.json、目录树、构建脚本；当时12条 |
| Komari 核心 | [96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f](https://github.com/komari-monitor/komari/tree/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f) | `web/api/admin/theme*.go`、`database/models/theme.go`、`web/public/public.go`、路由及公开RPC/WS源码 |
| Komari 官方商店 | [3f889543f6b839cb2452464e04306253f77791bd](https://github.com/komari-monitor/theme-market/tree/3f889543f6b839cb2452464e04306253f77791bd) | v1.json、README、目录树；当时64条，均有download和sha256 |

参考材料不作为可执行应用。Adhesive Note曾作为Komari适配前台；原始包与适配构建分别记录摘要，历史来源见[档案](../references/retired-themes/README.md)。当前产品不内置主题。

## 固定包的许可资料

CFSM Emerald构建`0939eb9d6e7638ea301f9dd18a218eedba2420c2`没有LICENSE；提交消息关联`v1.2.10`，对应源码提交`c80591198df4d2a0332b86b41e53e42fd341ed99`的MIT文件SHA-256为`3c9bd83dabc27cbe9870736c79deb8343c52f021c4acbca5d5156395854c1065`。该关联只适用于此构建，不能随分支更新沿用。

Adhesive Note 1.0.0 ZIP含MIT LICENSE及THIRD_PARTY.md；字体为SIL OFL 1.1，Twemoji图形为CC-BY 4.0。安装时展示实际版本的资料，不能把仓库代码许可证扩展到全部素材。已检查的原包版本、摘要和浏览器限制见[兼容清单](compatibility.md)。

## 实际分发形式

### CFSM

生产发现源是 [themes.json](https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/refs/heads/main/themes.json)，顶层 `{schema:1,themes:[…]}`。该版本12项的字段集合为 `id/title/cover/tags/description/url/branch/author`，**没有任何项包含 versions、文件校验和、许可证或协议能力字段**。这里是可缓存的公开静态 JSON，不是有独立兼容性承诺或可用性 SLA 的商店服务。

固定版本 CFSM 的商店 UI 先请求本站 `/theme`（服务端代理上述JSON），失败时直接读取raw源；无预置versions时调用 GitHub commits API，以目录声明的构建branch列出最多10个commit，生成完整 `tree/<SHA>` 主题URL。主题服务端读取该不可变位置的 `index.html` 和 `assets/…`，支持子目录，并给commit资源更长缓存。**不会替主题运行npm build**。有些主题依赖flags、OS图标、字体、地图、CDN脚本或绝对资源路径，需要单独资产审计；不能只验证index.html存在。

发现一处材料不一致：同一商店提交的 `scripts/build-themes.sh` 仍要求每项 `.versions[]`，并会安装依赖及构建；该固定目录12项均无versions，实际CFSM消费端已支持repo+branch。该脚本不能作为当前可用包接口，也不应由桥接器执行。目录branch应在安装时解析为完整commit并固定，不能每次访问追随main/build。

CFSM核心和商店仓库标识MIT；这不自动赋予每个主题、截图、字体和IP角色资源MIT授权。条目仓库和具体版本许可证必须独立读取、留存。

### Komari

生产发现源是 [v1.json](https://raw.githubusercontent.com/komari-monitor/theme-market/main/v1.json)，当前 `{schema,updated_at,themes:[…]}`。条目为 `name/short/description/version/author/url/preview/download/sha256`；name/description/author可为多语言对象。README明确包由作者托管，GitHub及非GitHub来源均可；没有包的条目可同时省略download和sha256。

固定核心实现也接受顶层数组或单个主题对象，LeoBridge的官方源解析器使用文档的版本化形状。核心将download和sha256同时存在视为**可安装**，下载后校验ZIP SHA-256，检查根manifest的short/version与目录匹配。SHA-256只能证明拿到目录指定字节，不能证明作者身份、无恶意代码或协议兼容；当前目录没有签名或统一能力矩阵。

包是ZIP：根 `komari-theme.json`，默认页面 `dist/index.html`，资源可以通过 `/themes/:id/*path` 访问。manifest字段为name、short、description、version、author、url、preview、configuration。configuration有managed/raw/redirect，managed声明string/number/select/switch等设置项；raw是管理配置HTML，redirect指向站内路径。**raw配置HTML不能放进LeoBridge可信管理源执行。** 当前LeoBridge保留raw/redirect声明但不执行其配置界面，managed保留默认值，尚无配置编辑UI。

核心有 `/api/admin/theme/market/sources|catalog|install` 等管理员接口，但这是部署实例内部的管理API，不能当成公共商店API，也无需运行Komari后端来复用目录。Komari核心MIT；该商店固定目录树未列出LICENSE，目录及每个主题的授权需要分别记录，不能套用核心许可证。

## 协议差异与安装边界

Komari公开消费者使用JSON-RPC 2.0 HTTP/WS及部分REST；旧式`/api/clients`文本get与CFSM subscribe/batchUpdate不同。固定核心WS曾把CPU真0变为0.01，LeoBridge保留真实0。具体方法、单位与偏差见[Komari协议](komari-protocol.md)，CFSM对应[消费者契约](frontend-contract.md)。

目录只提供发现与包定位。安装器核验固定来源、摘要、路径及大小，静态引用和外部依赖只作诊断，不要求全部资源自包含，也不执行构建脚本；协议兼容必须使用实际前台验证。可安装、已安装、已验证兼容分别记录，不能由目录出现或HTTP成功推断。资源、管理隔离及存储方案见[架构说明](../development/architecture.md)。
