# 默认前台来源与本地适配

历史记录：对应已移除的CFSM应用副本，以下路径均相对当时副本，不是本目录中的可执行工程。

本目录源自 CF-Server-Monitor 提交 `609cc0b0998793510453be8eadced2064b28ad7d`。`LICENSE` 保留上游 MIT 授权；`UPSTREAM.json` 保存复制前的文件 SHA-256，路径 `src/` 对应上游 `src/frontend/`，`shared/` 对应 `src/shared/`，`public/` 对应上游同名目录。可从固定提交取得原始文件并与UPSTREAM.json中的摘要核对；不在 `docs/references/upstream/` 修改或执行参考材料。

保留实际默认前台的 Dashboard、ServerDetail、卡片、样式、语言资源和 Chart.js 图表。桥接专用新增 `utils/bridge.js`、`components/BridgeStatus.vue`、`tests/bridge-state.test.js`；构建入口 `vite.config.js` 和 `scripts/build-frontend.mjs`。前台继承上游 JavaScript/Vue SFC，桥接业务和运行环境使用根工程 TypeScript。

本地差异：

- 精简 main/router，仅同源首页和服务器详情；移除管理页面，未知路由明确说明不支持。浏览器不读取探针 Token，也不发送遗留 CFSM localStorage 鉴权值。
- 配置只使用桥接器能力；历史范围来自 `bridge.history_hours`，移除原版大于24小时须CFSM管理员登录的限制。历史错误在页面显示；失败、空结果及切换范围清空旧曲线，竞态较旧请求不覆盖新选择。
- 历史断线阈值使用 `bridge.history_bucket_seconds` 的真实源桶宽，避免原版按120点估算时把6h/24h/48h的正常聚合点误当缺测切断。
- 显式 `online` 优先；超过45秒观察时间或上游断开显示数据过期。`bridgeStatus`、REST错误分别反馈；身份冲突/探针关闭清空旧列表和详情。首页每30秒读取权威列表并更新订阅；HTTP回退与上游原生WS分别标明。
- 缺省指标显示 `—`；历史缺省保留空点，真实0保留。上游每个完整快照可刷新名称隐藏、启动时间等字段。原版WS重连嵌套timer改成可取消timer，页面卸载清理连接和图表等待任务。
- 保留本地 flags/os-icons/favicon。默认站点字体使用系统等宽回退，不加载 Google Fonts。
- v0.1不开放可选地图（未供应地图资源及其第三方依赖）、财务汇率、Mikus风格和管理后台；对应入口关闭，`show_price/show_tf/theme_options` 由后端关闭。未支持指标以空图/缺省值和页面说明表示，不生成虚假历史。

注意：继承的语言字典中仍有上游管理文案；不代表包含管理页面或能力。上游图标资源随原仓库取得，保留原文件，不声称额外商标授权。LeoBridge自有代码的许可见根目录LICENSE；复制部分仍遵守上游及各素材条款。

专用构建及前台单元测试入口已随副本移除。历史补丁行为不代表商店原版行为，兼容边界见[消费者契约](../../../research/frontend-contract.md)。
