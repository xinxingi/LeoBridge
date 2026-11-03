# 源码构建与运行包制作

本文面向开发者和发行维护者。普通用户使用[预编译运行包](../deployment/local.md)或[Docker Hub镜像](../deployment/docker.md)，无需安装Node、pnpm或在目标机器编译。

## 本地开发和自行构建

准备Node.js 24+和项目锁定的pnpm11.25.0，在源码目录执行：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

`pnpm check`包含架构检查、类型、测试和构建；仅重建时使用`pnpm build`。产物包含应用`dist/node.js`、管理器`dist/local-service.js`及管理界面`dist/bundled`。本地开发使用`pnpm dev`前台运行，日志直接显示在终端，按Ctrl+C停止；前台运行构建产物使用`pnpm start`。`deploy/local/leobridge.sh`用于运行包后台启停，开发流程不调用它。不要让多个进程同时写同一状态目录。

管理脚本只运行已有产物，缺文件时明确报错，不会下载Node、安装pnpm或编译。开发时更新源码后先Ctrl+C停止，再按需安装依赖、构建并重新前台运行。准备依赖和构建环境由开发者完成，不属于普通用户的首次启动流程。

### 首次打开后台

完成上面的构建并运行`pnpm dev`后，打开 `http://127.0.0.1:8787/admin/`。无需复制`.dev.vars.example`或预先填写主控Token。

1. 全新状态且未自定义账号时，用`admin` / `admin`登录，设置12–128位、含大小写字母、数字和符号的新密码后重新登录。
2. 已有密码状态时使用当前已保存密码；用户名仍可通过`BRIDGE_ADMIN_USERNAME`配置。
3. 在“设置 → 数据源”填写主控地址和Token，检查连接、核对身份与Ping目标后“保存并应用”；随后安装、预览并启用主题。

### 日常修改配置

端口、代理等运行参数按需写入私有`.dev.vars`，参考[示例顶部的生效规则](../../.dev.vars.example)；运行参数每次启动读取，修改后Ctrl+C停止，再运行`pnpm dev`。已有文件直接编辑，不覆盖。更改管理界面源码后先`pnpm build`更新静态资源，再刷新浏览器。

密码和数据源在后台修改，成功后立即生效，统一保存在`work/theme-store/state.json`，不在`.dev.vars`中配置。源码重建和重启保留状态。旧版本迁移及存储路径见[配置在哪里修改和保存](../configuration.md#配置在哪里修改和保存)。

## 制作自带Node的运行包

当前采用运行包：包含Node可执行文件、已构建应用、生产依赖、管理资源和启停脚本。不是单文件可执行程序。打包在构建机器完成，用户解压后不需要Git、Node、npm或pnpm。源码中的启动脚本位于`deploy/local/leobridge.sh`，打包时复制到运行包根目录，用户仍执行`./leobridge.sh start`。

1. 在目标平台的构建机器准备并验证源码、锁文件和构建产物。
2. 从Node官方分发站获取选定的固定Node24系列版本，校验该版本官方SHA-256后解压；保留完整分发目录和LICENSE。选择与构建机器系统、架构一致的包，正式发行时记录具体版本和摘要。
3. 执行以下命令，`--node-dir`指向上一步已校验的Node分发目录：

```sh
pnpm build
pnpm package:local --node-dir /path/to/verified-node-distribution --out-dir /path/to/output
```

输出`leobridge-<版本>-<系统>-<架构>.tar.gz`及同名`.sha256`。打包器支持Linux/macOS、x64/arm64的本机打包；当前Release工作流只发行Linux x64和arm64，两种Linux架构分别使用对应构建机器，本命令不声称交叉编译或跨架构运行验证。

打包器只取已构建应用、资源、生产依赖及其传递依赖、Node二进制与许可证，不复制源码、开发工具、私有配置或现有work状态，不包含npm/pnpm。生产包原始许可证随包保留。遇到依赖循环或缺失会拒绝打包；依赖布局改变时应重新审查。输出已存在时拒绝覆盖。

使用当前构建平台实际执行`node scripts/verify-release.mjs package /path/to/output/<包名>.tar.gz`，检查摘要、包内容、无系统Node/npm/pnpm的启动、改密和重启持久化。脚本使用独立临时目录及空数据源，结束时停止测试实例，不读取用户状态。已有单元测试的合成样例不能替代实际发行包检查；产物检查也不能替代目标环境的升级/回退及真实前台验收。

## 自行构建Docker镜像

最终Docker镜像包含应用、依赖和管理资源，不包含运行包的启停管理器；容器生命周期由Docker负责。

```sh
docker build --tag leobridge:local --file deploy/docker/Dockerfile .
node scripts/verify-release.mjs image leobridge:local
```

容器检查创建独立临时容器和数据卷，验证空源启动、改密及重启持久化后清理；不会访问真实主控。

默认基础镜像为`node:24-bookworm-slim`。需要可复现发行时，用`--build-arg NODE_IMAGE=<已审查的tag@sha256摘要>`固定基础镜像，记录源码提交、锁文件和镜像摘要。`.dockerignore`使用白名单，私有配置、原始响应、Git历史及参考源码不进入构建上下文。

自行构建的镜像也可使用同一Compose配置：在`compose.yaml`中将`services.app.image`改为`leobridge:local`，其余选项默认即可本机访问，按需调整应用端口和访问策略后，运行`docker compose up -d --pull never`。Compose本身没有build步骤；普通部署文档使用发布的Docker Hub固定版本镜像。

## 验证与发布状态

```sh
pnpm check
BRIDGE_TEST_BUILT_NODE=1 pnpm test:runtime
```

本地打包不上传GitHub Release、不推送Docker Hub。标签发布工作流统一生成运行包、校验文件及对应镜像标签，步骤和凭据配置见[版本发布](releasing.md)。普通提交/PR只运行检查，只有推送版本标签才发布；公开产物是否已就绪以实际Actions、GitHub Release和Docker Hub结果为准。

历史`scripts/verify-container.mjs`依赖预先安装的双主题、对应资源和已完成改密的管理状态，当前空主题构建不能直接复现，适配仍待完成。Node测试不替代实际容器、域名/TLS、真实源和浏览器验收。
