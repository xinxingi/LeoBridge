# 源码构建与运行包制作

本文面向开发者和发行维护者。普通用户使用[预编译运行包](../deployment/local.md)或[Docker Hub镜像](../deployment/docker.md)，无需安装Node、pnpm或在目标机器编译。

## 本地开发和自行构建

准备Node.js 24+和项目锁定的pnpm11.25.0，在源码目录执行：

```sh
pnpm install --frozen-lockfile
pnpm check
./leobridge.sh start
```

`pnpm check`包含架构检查、类型、测试和构建；仅重建时使用`pnpm build`。产物包含应用`dist/node.js`、管理器`dist/local-service.js`及管理界面`dist/bundled`。开发时可使用`pnpm dev`，前台运行构建产物可使用`pnpm start`；后台管理沿用`leobridge.sh`。不要让多个进程同时写同一状态目录。

管理脚本只运行已有产物，缺文件时明确报错，不会下载Node、安装pnpm或编译。更新源码后先stop，再显式安装必要依赖、构建并start。准备依赖和构建环境由开发者完成，不属于普通用户的首次启动流程。

配置可放在私有`.dev.vars`中，运行状态默认保存到`work/theme-store`。修改网络配置后restart；后台保存的数据源和管理密码无需随源码重建。生产访问、备份和迁移见部署指南。

## 制作自带Node的运行包

当前采用运行包：包含Node可执行文件、已构建应用、生产依赖、管理资源和启停脚本。不是单文件可执行程序。打包在构建机器完成，用户解压后不需要Git、Node、npm或pnpm。

1. 在目标平台的构建机器准备并验证源码、锁文件和构建产物。
2. 从Node官方分发站获取选定的固定Node24系列版本，校验该版本官方SHA-256后解压；保留完整分发目录和LICENSE。选择与构建机器系统、架构一致的包，正式发行时记录具体版本和摘要。
3. 执行以下命令，`--node-dir`指向上一步已校验的Node分发目录：

```sh
pnpm build
pnpm package:local --node-dir /path/to/verified-node-distribution --out-dir /path/to/output
```

输出`leobridge-<版本>-<系统>-<架构>.tar.gz`及同名`.sha256`。当前支持Linux/macOS、x64/arm64的本机打包；Linux x64、arm64须分别使用对应构建机器，本命令不声称交叉编译或跨架构运行验证。

打包器只取已构建应用、资源、生产依赖及其传递依赖、Node二进制与许可证，不复制源码、开发工具、私有配置或现有work状态，不包含npm/pnpm。生产包原始许可证随包保留。遇到依赖循环或缺失会拒绝打包；依赖布局改变时应重新审查。输出已存在时拒绝覆盖。

解压到独立目录，以不含Node/npm/pnpm的PATH执行start/status/restart/stop，检查管理页、状态持久化和日志；同时核对包内没有私有文件，摘要匹配。已有单元测试的合成样例不能替代实际发行包验证。正式发版还需Linux目标运行、升级/回退及真实前台验收。

## 自行构建Docker镜像

最终Docker镜像包含应用、依赖和管理资源，不包含运行包的启停管理器；容器生命周期由Docker负责。

```sh
docker build --tag leobridge:local --file deploy/docker/Dockerfile .
```

默认基础镜像为`node:24-bookworm-slim`。需要可复现发行时，用`--build-arg NODE_IMAGE=<已审查的tag@sha256摘要>`固定基础镜像，记录源码提交、锁文件和镜像摘要。`.dockerignore`使用白名单，私有配置、原始响应、Git历史及参考源码不进入构建上下文。

自行构建的镜像也可使用同一Compose配置：在配置文件中将`LEOBRIDGE_IMAGE`设为`leobridge:local`，填写其余域名、证书及访问策略后，运行`docker compose up -d --pull never`。Compose本身没有build步骤；普通部署文档使用发布的Docker Hub固定版本镜像。

## 验证与发布状态

```sh
pnpm check
BRIDGE_TEST_BUILT_NODE=1 pnpm test:runtime
```

本地打包不上传GitHub Release、不推送Docker Hub。自动发布工作流、公开运行包和公开镜像尚未交付，不把本地生成的压缩包当作已发布版本。后续发布应由同一版本源码生成运行包、校验文件及对应镜像标签。

历史`scripts/verify-container.mjs`依赖预先安装的双主题、对应资源和已完成改密的管理状态，当前空主题构建不能直接复现，适配仍待完成。Node测试不替代实际容器、域名/TLS、真实源和浏览器验收。
