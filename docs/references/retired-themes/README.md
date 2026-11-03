# 已移除主题的来源档案

2026-11-03起，LeoBridge不再随产品交付第三方主题源码或构建包。此目录只保留以前适配过的主题来源、原文件摘要、补丁记录、上游说明及许可文本，不参与构建；补丁记录中的路径指当时副本。原样保存的UPSTREAM_README.md和THIRD_PARTY.md中的命令、相对链接及“本仓库”指各自上游，不是LeoBridge操作说明；未留存文件从下表固定来源查看。已有实例的安装资源与声明仍保留在各自状态目录，不被升级删除。

| 历史主题 | 固定来源 | 留存文件 |
| --- | --- | --- |
| CFSM默认前台 | [CF-Server-Monitor@609cc0b](https://github.com/huilang-me/CF-Server-Monitor/tree/609cc0b0998793510453be8eadced2064b28ad7d) | [MIT](cfsm/LICENSE)、[来源摘要](cfsm/UPSTREAM.json)、[历史补丁](cfsm/PATCHES.md) |
| Komari官方前台 | [komari-web@bed58b5](https://github.com/komari-monitor/komari-web/tree/bed58b589da63232a17681b1dbaed9eab2423078) | [来源说明](komari-default/SOURCE_TERMS.md)、[原README](komari-default/UPSTREAM_README.md)、[来源摘要](komari-default/UPSTREAM.json)、[历史补丁](komari-default/PATCHES.md) |
| Adhesive Note | [Adhesive Note@8ac4fd2](https://github.com/stqfdyr/komari-theme-adhesive-note/tree/8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914) | [MIT](komari/LICENSE)、[第三方素材说明](komari/THIRD_PARTY.md)、[来源摘要](komari/UPSTREAM.json)、[历史补丁](komari/PATCHES.md) |

Komari官方前台该固定版本未发现独立LICENSE；NOASSERTION不是无版权或任意使用授权。CFSM和Adhesive Note的代码采用MIT，主题素材与依赖仍适用各自条款。本项目MIT不替代这些条款。历史适配包的兼容结论不覆盖商店原版，参见[兼容清单](../../research/compatibility.md)。

商店目录许可不覆盖每个主题；新安装展示可获得的许可文件，记录用户知情确认，不作授权判断。详见[主题管理](../../themes.md)。npm依赖按锁文件固定，各自的LICENSE随依赖保留；项目图形的来源见[品牌素材](../../assets/README.md)。
