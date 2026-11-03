# 主题公共资源来源

LeoBridge只保存固定来源及SHA-256索引，不在构建中附带第三方资源字节。资源在使用时从固定上游读取并校验，原资源名称、格式和内容保持不变。项目MIT许可证不覆盖第三方图片、字体或商标；适用条款仍见对应上游来源。

## Komari 默认主题公共资源

原生Komari先查当前主题，找不到时回退默认主题资源。依据为核心固定提交[`96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f`](https://github.com/komari-monitor/komari/blob/96cf0f79d8cfdf6cc8be54fd1976bbc026d58f7f/web/public/public.go)的getFileContent。

当前公共路径索引来自官方前台[`bed58b589da63232a17681b1dbaed9eab2423078/public`](https://github.com/komari-monitor/komari-web/tree/bed58b589da63232a17681b1dbaed9eab2423078/public)，SHA-256沿用已核对的[来源清单](retired-themes/komari-default/UPSTREAM.json)。官方前台没有独立LICENSE，许可边界见[来源说明](retired-themes/komari-default/SOURCE_TERMS.md)，不套用Komari后端MIT许可证。

部分旧主题继续请求PNG系统图标。官方提交[`aa4e78bb40c2fc5569af065b7999a33e1bab1374`](https://github.com/komari-monitor/komari-web/commit/aa4e78bb40c2fc5569af065b7999a33e1bab1374)删除这些PNG并改为WebP。以下路径从其前一提交[`baf5db69492303b126e5188726f1fc308aee6d14`](https://github.com/komari-monitor/komari-web/tree/baf5db69492303b126e5188726f1fc308aee6d14/public/assets/logo)获取原始PNG，而非重命名或转码新版WebP。对所有主题按公共路径适用，不按主题名称分支。

| public下的路径 | 原始字节SHA-256 |
| --- | --- |
| assets/logo/os-OpenCloudOS.png | `3c45e4f59d03a1768c9b10eb9178ec243ef495a97de81ce71d9773a38c51b2aa` |
| assets/logo/os-astar.png | `aa9ef47c968feb8f13d228cb4431bddc650702d1be7220cfa2f9efe38bce4fdd` |
| assets/logo/os-istore.png | `803a7c0662e43f891e773154eced5ed6665a176c2ee4cd7f33b0422128f208ca` |

这些映射仅提供有实际来源的资源兼容；不保证其他主题的任意缺失路径存在，也不将资源返回成功当作主题协议兼容验收。

## 已识别CSS库的资源依赖

部分静态分发只带库CSS而未带其字体或精灵图。LeoBridge只为已核实的公共库提供缺失依赖来源，不按主题名称分支，也不根据相似文件名猜测来源。识别完整的字体声明、图标字形和旗帜规则规范化指纹，普通页面样式不参与指纹；字体URL、字形或旗帜规则变化将不再命中。

当前识别Semantic UI CSS依赖，原始资源固定为[`Semantic-Org/Semantic-UI-CSS@fc9f8bd7e4f5934756ec60c0423f77d1c7be7c6f`](https://github.com/Semantic-Org/Semantic-UI-CSS/tree/fc9f8bd7e4f5934756ec60c0423f77d1c7be7c6f/themes/default/assets)（tag 2.4.1）。仅登记该版本的字体和flags.png，共17个路径，不包含JavaScript。每项SHA-256记录于`src/themes/resource-sources-css.ts`；路径相对实际CSS位置解析，CSS字节保持原样。

核对材料：

- 官方固定分发semantic.min.css的完整字体声明、图标字形和旗帜规则指纹为`ca7b17c41d4d68feffef3572e1702147bf559f76f0a3960907c656003c473776`。
- [`cokemine/hotaru_theme@a4f46a4cd4159abf2c05ec166a1e6622469352d8/package-lock.json`](https://github.com/cokemine/hotaru_theme/blob/a4f46a4cd4159abf2c05ec166a1e6622469352d8/package-lock.json)锁定semantic-ui-css 2.4.1。其public/css/semantic.min.css头部写2.4.2，但相关完整库规则与上述固定分发一致。商店Hotaru ZIP中的同文件仅有CRLF差异，同样命中库规则指纹；不为该主题单独登记整份CSS摘要。
- Semantic UI库的[LICENSE](https://github.com/Semantic-Org/Semantic-UI-CSS/blob/fc9f8bd7e4f5934756ec60c0423f77d1c7be7c6f/LICENSE)为MIT。字体内声明Font Awesome Free 5.0.8，原[字体文件说明](https://github.com/Semantic-Org/Semantic-UI-CSS/blob/fc9f8bd7e4f5934756ec60c0423f77d1c7be7c6f/themes/default/assets/fonts/icons.svg)列明Icons为CC BY 4.0、Fonts为SIL OFL 1.1、Code为MIT。资源拉取不改变这些条款，不能用库MIT笼统覆盖所有素材。

未知CSS依赖不自动获得来源。缺失资源仍需明确记录；此登记只补已核实的库分发依赖，不表示原主题的全部功能或数据语义均通过验收。

## CFSM 默认主题公共图像

CFSM资源索引固定为[`huilang-me/CF-Server-Monitor@609cc0b0998793510453be8eadced2064b28ad7d/public`](https://github.com/huilang-me/CF-Server-Monitor/tree/609cc0b0998793510453be8eadced2064b28ad7d/public)，SHA-256来自[原始来源清单](retired-themes/cfsm/UPSTREAM.json)。仅登记271个`flags/*.svg`、26个`os-icons/*`以及`favicon.ico`和`favicon.png`，共299项图像；不登记默认前台入口、JavaScript、管理页面或其他源码。

所选主题自己的资源优先；该公共索引用于相同公开路径的缺失资源回退，适用于所有CFSM主题，不以Horizon等主题名称选择。原文件按固定提交读取、原格式返回，路径保持大小写；不存在的路径不会自动猜测或替换。

固定仓库的[LICENSE](https://github.com/huilang-me/CF-Server-Monitor/blob/609cc0b0998793510453be8eadced2064b28ad7d/LICENSE)为MIT；图片、标识仍保留上游来源，不声称取得额外商标授权。运行时拉取不表示LeoBridge将这些素材改编为自有资源。
