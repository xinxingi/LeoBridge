# 开发资料索引

整理日期：2026-11-02（Asia/Shanghai）。先读本文与兼容清单，再按需查原文。

## 已保存资料

CFSM 固定提交：`609cc0b0998793510453be8eadced2064b28ad7d`。

| 材料 | 本地位置 | 用途 |
| --- | --- | --- |
| CFSM README | [原文](upstream/cfsm-README.md) | 架构、构建与部署方式 |
| CFSM API | [原文](upstream/cfsm-API.md) | 返回结构、字段、鉴权及错误码 |
| CFSM 主题规范 | [原文](upstream/cfsm-theme-develop.md) | 前端配置、主题资源、REST 与实时订阅 |
| CFSM 许可证 | [MIT](upstream/cfsm-LICENSE) | 代码和资料复用署名 |
| CFSM 关键源码 | [路径清单](source-map.md) | 对照实际消费者和服务端实现 |
| 妙妙屋X探针说明 | [人工整理摘录](mmwx-probe-notes.md) | 输入数据契约；不是完整原文或实测响应 |
| 文件来源与摘要 | [manifest.json](manifest.json) | 固定 URL、Git blob SHA 与本地 SHA-256 |
| 合成输入样例 | [样例说明](../fixtures/README.md) | 在线、离线、零值、隐藏名称及身份歧义；不是实测响应 |

CFSM 原始文件按固定提交下载并保持内容不变。源码目录只有选定参考文件，**不是完整可运行的前端副本**。API 文档中的历史修订日期和版本号可能落后于当前提交，应交叉核验。

妙妙屋X页面于本次通过浏览器读取，页面标记最近更新为 2026-10-31。命令行抓取返回 HTTP 403，因此保存的是标明来源的人工整理摘录，未声称持有完整网页快照或 OpenAPI 定义。

妙妙屋X公开仓库 `iluobei/miaomiaowuX` 的参考提交是 `dda3d699a4669e281cf98575057146169dc0e72d`。检查其递归目录后，只发现 README、安装脚本、规则和配置等；没有发现探针服务端接口实现。该提交**不能代表文档网站或用户主控的版本**。后续实现依赖文档和真实主控联调，不能虚构源码依据。

## 在线入口

- [妙妙屋X探针 API](https://miaomiaowux.com/docs/probe-api/)
- [妙妙屋X外置探针](https://miaomiaowux.com/docs/install-external-probe)：本次未审阅，鉴权与外置部署实现前补读。
- [CFSM固定源码树](https://github.com/huilang-me/CF-Server-Monitor/tree/609cc0b0998793510453be8eadced2064b28ad7d)
- [CFSM主题市场](https://github.com/huilang-me/CFSM-Theme-Store)：主题规范指向此项目，本次未选取第三方主题。
- [Komari](https://github.com/komari-monitor/komari)：已审计公开RPC2/WS及主题契约，固定版本、真实Adhesive Note来源与许可见[双生态调查](../research/theme-ecosystems.md)及[Komari前台](../research/komari-frontend.md)。

## 维护方式

升级参考版本时先选择一个明确提交，再替换文档与对应源码，更新 manifest，记录接口差异并跑兼容测试。不要单独更新某一份文档后继续声称所有材料来自同一版本。

第三方代码和资源按各自许可证使用；额外授权须有可核实的范围和依据，不以私人对话替代许可。
