# 本地 Workers 双主题运行时验收

日期：2026-11-02。目标是本机 workerd（端口8795）、本地模拟R2和Durable Object，以及端口8791的合成上游。**这不是Cloudflare云端部署验证，也不是真实主控数据联调。** 真实Node服务及其管理状态不在本脚本操作范围。

## 可重复检查

先安装锁定依赖并构建两个本地主题，再生成专用合成配置：

```sh
pnpm install --frozen-lockfile
pnpm build
node --import tsx scripts/configure-worker-fixture.ts
node --import tsx scripts/configure-worker-fixture.ts --check
```

生成器只读取源码路径及`dist/bundled/`构建清单，不读取仓库真实`.dev.vars`、真实主控Token或真实管理密码。默认生成以下三个文件，均为Git忽略、权限0600：

- `work/private/worker-fixture/wrangler.toml`：本地Worker入口、两个主题资产目录、R2/DO模拟绑定及迁移声明。
- `work/private/worker-fixture/.dev.vars`：只含合成主控`127.0.0.1:8791`、三个Synthetic节点绑定及独立合成管理口令。
- `work/private/worker-fixture/runtime.env`：只含验收脚本所需`BRIDGE_RUNTIME_PASSWORD`，加载时不输出值。

生成器复跑会核对已有文件；内容不同则明确拒绝覆盖，可用`--directory work/private/另一个专用目录`另建。原先`work/private/wrangler-fixture.toml`和真实Node服务8787不被生成器修改。配置中的路径由当前检出位置生成，可在另一台机器重新生成；不需复制本文记录机器的绝对路径。

在终端A运行**独立合成上游**（若8791已有同一合成进程，直接复用）：

```sh
node --import tsx scripts/configure-worker-fixture.ts --serve-upstream
```

该模式只在`127.0.0.1:8791`提供合成HTTP/WS，每5秒推进合成指标；不启动额外Node桥接器。它沿用`fixture-demo.ts`的三个节点、10个历史桶和一个缺失Ping桶契约。原`fixture-demo.ts`会再启动Node子进程，该子进程会读取仓库`.dev.vars`，因此这里使用独立上游模式获得明确的配置隔离。若端口已占用，启动会失败而不会遗留重试进程；Ctrl-C关闭该合成上游。

在终端B启动本地workerd，使用生成配置和独立本地状态目录：

```sh
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
CLOUDFLARE_INCLUDE_PROCESS_ENV=false \
WRANGLER_SEND_METRICS=false \
pnpm exec wrangler dev --local \
  --config work/private/worker-fixture/wrangler.toml \
  --port 8795 --ip 127.0.0.1 --inspector-port 9235 \
  --persist-to work/private/worker-fixture/state
```

当前锁定Wrangler会按`--config`所在目录加载相邻`.dev.vars`；生成目录中的完整合成变量文件阻断了对仓库真实配置的依赖，上述环境开关同时禁用dotenv及进程变量回退。`--local`将R2和Durable Object保存在指定本地状态目录，不创建云资源。首次请求会将`dist/bundled/index.json`里的两个版本种入本地模拟存储。8795已有对应合成workerd时可直接复用，不能在同一端口重复启动；本轮生成验证没有启动新长期服务。

终端C加载合成验收口令并执行检查，子shell结束后不保留该环境变量：

```sh
(
  set -a
  . work/private/worker-fixture/runtime.env
  set +a
  node --import tsx scripts/verify-theme-runtime.ts
)
```

`scripts/verify-theme-runtime.ts`固定访问8795，TCP连接127.0.0.1并保留不同Host，因此无需依赖`*.localhost`的DNS解析或修改hosts文件。脚本不读取`.dev.vars`、主控Token或生产管理密码，不下载商店或主题包，只操作已种入本地R2的两个构建版本：

- 管理登录、host-only/HttpOnly/SameSite cookie、会话信息不出现在公开主题状态。
- 只从本地构建清单选择已安装CFSM及Komari版本；先确认源端返回合成样例，再启用Komari、检查根307跳转，最后回退CFSM并注销。
- 真实主题HTML及JS/CSS完整字节与`dist/bundled/<id>/`对照；特意读取资源清单中非零offset的文件，核对R2内部range读取的长度和SHA-256。浏览器HTTP Range当前未实现，资源200全量响应不记作206支持。
- Komari RPC2节点、1小时/7天系统和Ping历史、原生WS合成指标变化；旧CFSM不可变版本URL仍返回CFSM结构。
- 管理变更拒绝外部Origin、错误CSRF及陈旧generation；主题源不能读取管理API；注销后的同一cookie访问状态必须401。
- 发生中途失败时，尽力恢复CFSM并注销；失败证据独立保留，不覆盖重跑结果。

每轮原始响应及摘要保存在忽略的`work/private/worker-themes/<UTC时间>/`，stdout只输出结构统计；管理密码和cookie不打印。生成目录的`state/`仅是本地模拟存储，保留它可复验持久状态；需要全新模拟状态时选择新生成目录及对应`--persist-to`，无需删除旧证据。

本轮基础生成验证实际通过：生成3个文件、校验两个主题构建，随后`--check`通过；重复执行未覆盖既有文件，三个文件均被Git忽略且权限0600；根类型检查通过。生成阶段尚未启动新服务；主代理随后按文档从新目录完成独立全链验证，见文末。以下既有失败及成功证据原样保留。

## 实际记录

首次执行：`2026-11-02T13-55-35-164Z`。未登录读取管理状态返回预期401；登录返回500 `INTERNAL_ERROR`，尚未得到会话，未执行主题切换。已报告主代理检查真实workerd异常，不能将此轮标记通过。

第二次执行：`2026-11-02T14-01-07-081Z`，登录同样返回500。检查workerd异常后确认根因：`WorkerThemeStore`构造时保存了Durable Object stub，后续请求复用时触发“Cannot perform I/O on behalf of a different request”。修复为每次 `state` / `command` 调用取得当前请求的stub。先前将其怀疑为热重载问题没有证据，不作为故障结论。

修复后完整复验：`2026-11-02T14-03-46-555Z`，`work/private/worker-themes/2026-11-02T14-03-46-555Z/summary.json` 全部检查通过：

- 登录200；未登录和注销后状态401；cookie隔离和公开状态不泄露会话通过。
- 两个本地安装版本存在；切换Komari和回退CFSM均200，根入口307指向各自不可变版本，预览和管理源隔离通过。
- 两个非零偏移静态资源的完整长度与SHA-256匹配本地构建。HTTP Range请求实际返回200全量文件，未宣称支持206。
- 外部Origin403、错误CSRF403、旧generation409，拒绝操作未改变当前generation；主题源读取管理状态404。
- Komari RPC返回3个合成节点；1小时系统10点/Ping9点，跨度0.75小时；168小时系统10点/Ping9点，实际跨度18小时。未填满请求范围或伪造采样。
- Komari WS升级101，3条有效RPC响应、3个不同原生上游观测，指标确实变化，RPC错误0，正常关闭1000（10.009秒）。
- 已保留的CFSM版本仍返回原CFSM协议，3个合成节点；最终恢复CFSM并注销会话。

CFSM固定版本路由脚本复验：`scripts/verify-live.ts` 已先解析 `/__bridge/version`，只允许同协议、同端口的本机307/308跳转，固定后续HTTP和WS的安装源。遇到Komari安装会明确失败，不能将其误测为CFSM。通过本机TCP连接并保留Host及TLS SNI，避免依赖 `*.localhost` DNS。

`2026-11-02T14-08-04-152Z` 使用 `BRIDGE_VERIFY_BASE_URL=http://127.0.0.1:8795`、`--only=config,list,detail,ws` 实测通过。证据：`work/private/bridge-acceptance/2026-11-02T14-08-04-152Z/summary.json`。根入口经过1次307抵达CFSM安装；config/list/detail均200，3个合成节点；WS101，2条原生batch、0轮询、指标变化、关闭1000（2.243秒）。此前沙箱内执行无法连接本机，单独保留为失败记录 `2026-11-02T14-07-48-480Z`；取得本机联网权限后才成功。此次未运行CFSM历史检查，不能代替其历史验收。

修改后的 `tsc --noEmit` 实际通过。上述结果均为本机workerd和合成数据检查，真实浏览器渲染、真实主控联调及Cloudflare云端部署分别记录，不由这里的HTTP/WS通过推断。

主代理最终完整复验：`2026-11-02T14-34-14-368Z`，证据为 `work/private/worker-themes/2026-11-02T14-34-14-368Z/summary.json`，全部检查通过。管理登录、源隔离、CSRF及陈旧generation拒绝、1小时/7天系统和Ping历史、两个R2非零偏移资源的完整字节校验、主题切换与CFSM回退、注销会话撤销均通过；原生合成WebSocket返回3次有效响应、3次上游观测，内容变化，RPC错误0，正常关闭1000（10.008秒）。

本次完整复验复用了既有 `work/private/wrangler-fixture.toml` 运行配置及8791/8795服务。截至该轮，新生成目录 `work/private/worker-fixture/` 仅完成文件生成、重复执行、配置检查和类型检查；随后另行验证，见下文。此次仍是本机workerd和合成数据，未执行云端部署。


## 新生成目录的独立复现

主代理停止旧合成服务后，按本文命令启动独立`--serve-upstream`和新目录的wrangler配置，使用全新本地state。确认Wrangler加载相邻合成`.dev.vars`，源仅为8791、实际只有3个Synthetic节点；未改真实8787服务配置。

`worker-themes/2026-11-02T14-40-38-731Z/summary.json` 的29项检查全部通过，包括初始种入两个包、管理权限、R2资源、1h/7d历史、切换/回退/退出，3次原生合成WS观察及指标变化，close1000（10.009秒）。因此新文档启动路径已有独立端到端证据，不再仅依赖旧配置。验收后停止临时8791/8795进程，状态及失败/成功证据仍保留在忽略目录。
