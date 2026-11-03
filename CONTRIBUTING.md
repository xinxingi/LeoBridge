# 贡献指南

先阅读[项目说明](README.md)、[架构边界](docs/development/architecture.md)和[兼容说明](docs/research/compatibility.md)。

## 开发流程

1. 使用Node24和锁定的pnpm11.25.0，执行`pnpm install --frozen-lockfile`。
2. 修改前确认相关固定上游契约；`docs/references/upstream/`是参考副本，不在其中安装或修改应用代码。
3. 按 [README](README.md#快速开始) 启动，在后台配置数据源；开发时运行 `pnpm dev`。本地配置与状态只存忽略文件，已有绑定和管理员密码不要重新生成。
4. 修改对应模块和有意义的边界测试，运行`pnpm check`。这个命令检查依赖边界、类型、自动化测试和应用构建。
5. PR描述问题、最终行为、实际验证与限制。前台协议改动应附真实前台验证，不能只以HTTP200或合成样例判断兼容。

保持一个锁文件。核心/上游/协议/管理/运行时的允许依赖在架构文档中定义，并由`pnpm check:architecture`检查。不要为目录统一而引入不必要的框架、空模块或数据存储。

## 测试材料

`docs/fixtures/`及脚本中Synthetic数据仅验证实现。`work/`是忽略的本地运行状态与私有证据，不能作为发行内容。真实联调必须得到源拥有者授权，只读执行；不要为制造离线、排序或隐藏场景修改真实主控。

`pnpm verify:live`和`node --import tsx scripts/verify-komari.ts --origin ...`会访问已启动本地桥接器；它们不在普通单元测试中自动运行。`pnpm test:runtime`运行VPS模式的纯合成集成；构建后使用`BRIDGE_TEST_BUILT_NODE=1 pnpm test:runtime`验证实际`dist/node.js`入口。部署检查见[VPS部署指南](docs/deployment/vps.md)。不要将未经验证的部署、截图、性能或覆盖率写成通过。

## 来源与公开信息

主题副本的LICENSE、UPSTREAM、PATCHES须随代码保留；第三方代码和字体许可见[声明](docs/references/retired-themes/README.md)。提交之前检查凭据、原始响应、服务器名称/绑定和私有地址。安全问题按[安全说明](SECURITY.md)处理。

提交内容应包括代码、必要的使用说明和可复现的验证方法。个人工作计划、AI 会话记录、临时验收日志和测试环境交接信息仅保留在本地，不提交到仓库。PR 中说明本次修改的实际验证结果与限制。
