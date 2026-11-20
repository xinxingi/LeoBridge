# LeoBridge 品牌素材

项目标志、字标、README横幅及管理后台图标。

| 素材 | 用途 |
| --- | --- |
| [logo.svg](logo.svg) | 640 × 640，透明底炭黑标志，矢量母版 |
| [logo.png](logo.png) | 同尺寸透明 PNG，供不支持 SVG 的场景使用 |
| [后台图标](../../web/admin/logo.svg) | 炭黑圆角底、银白色狮头，侧栏、登录页及 favicon 共用 |
| [wordmark.svg](wordmark.svg) | 730 × 170，透明底炭黑艺术字标，已转为矢量路径 |
| [readme-banner.svg](readme-banner.svg) | 1600 × 520，可编辑横幅 |
| [readme-banner.png](readme-banner.png) | README 使用的固定渲染，避免字体差异影响排版 |

主色为炭黑`#25292e`与银白`#f3f4f5`，管理界面颜色变量在`web/admin/styles.css`。

修改标志时以`logo.svg`为母版，同步后台图标和横幅，再导出PNG并目视检查。字标已转为路径；横幅辅助文字使用系统字体，导出需要中文字库。正常构建无需图形工具。

## 来源

参考文件：`2026-10-29 12.50.19.jpg`，由项目所有者提供并指定用于本项目。

SHA-256：`feb0a11ec3d8780aca44874e318ca338cd09c1d89dd7ae6474d992f035f16402`。

原图未附独立作者或许可声明，因此不将狮头图形另行声明为原创或自动纳入代码的 MIT 授权。此处记录本项目中的使用来源；项目代码、上游主题和品牌图形的来源分别维护。

字标以本机 Baskerville Bold Italic 排字为基础，调整字距与 L 收笔后导出为固定文字轮廓；仓库不分发字体文件。
