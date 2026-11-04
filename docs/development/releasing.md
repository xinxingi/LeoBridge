# 版本发布

日常开发进入`develop`，通过PR合入`main`后选择确定提交打版本标签。分支提交和PR只运行`check`，不会上传镜像或创建GitHub Release。只有推送`v*`标签才触发[发布工作流](../../.github/workflows/docker-release.yml)，没有手动触发入口。

当前发行版本为`v0.2.0`，用户下载入口见[部署方式](../deployment-checklist.md)。Git标签`v0.2.0`标记源码提交，GitHub Release关联该标签并提供说明与附件，Docker标签为`staractive/leobridge:0.2.0`（不带v）。三个名称的版本号须一致。

## 首次配置

在GitHub仓库Settings → Secrets and variables → Actions添加Repository secrets：

- `DOCKERHUB_USERNAME`：`staractive`。
- `DOCKERHUB_TOKEN`：拥有镜像推送权限的Docker Hub访问Token。

镜像仓库为`staractive/leobridge`，用户匿名拉取需要仓库为Public。GitHub Release上传使用该任务自动取得的`GITHUB_TOKEN`，仅上传任务授予`contents: write`，无需另存GitHub个人Token。构建使用GitHub托管Linux x64和arm64运行器，需要仓库可使用`ubuntu-24.04`和`ubuntu-24.04-arm`及相应Actions额度。

## 正常发版

1. 在`develop`更新`package.json`中的版本号，Compose的`services.app.image`保持`staractive/leobridge:latest`，更新使用说明及升级注意事项，通过PR合入`main`。Release会复制该标签的部署模板，正式发版校验镜像后将其更新到latest；镜像地址不在`.env`中配置。
2. 确认`main`对应提交的`check`通过。该检查包含架构、类型、全部测试、Node构建、构建产物运行时、Worker打包和实际Compose模板的配置预检查、启动/改密/重建验证。Worker打包不是云部署。
3. 给选定的`main`提交创建带注释的标签并推送。以下以**下一次补丁版本`0.2.1`**为例，先确保该版本已写入`package.json`并合入main；不要重复使用已发布的`v0.2.0`。远端名按自己的`git remote -v`结果填写，远端名称与分支名称不同：

```sh
git fetch <远端名> main
git show <已核对的main提交SHA>:package.json
git tag -a v0.2.1 <已核对的main提交SHA> -m "LeoBridge v0.2.1"
git push <远端名> refs/tags/v0.2.1
```

标签必须使用三段版本号并与`package.json`完全一致，且目标提交必须已进入远端`main`；例如包版本`0.2.1`使用`v0.2.1`，不能写`v0.2`。`v0.2.1-rc.1`要求包版本为`0.2.1-rc.1`，新建GitHub Release会标记为预发布。通常由工作流在全部工件准备完成后自动创建Release；同标签Release已存在时上传附件并替换同名附件，保留原说明、标题和草稿/预发布状态。已有草稿仍需管理员确认后发布；已有说明中的镜像摘要需与本次Docker任务输出核对。

4. 在Actions查看`Docker and Release packages`。失败时先读取失败步骤并修复原因，不通过移动已公开标签替换代码；代码需要变化时发布新的版本号。

5. 成功后核对Release的7个附件、镜像的两种架构和digest，再更新README、部署指南及兼容清单中的发行版本。GitHub Release是否可匿名下载由仓库可见性决定；Docker Hub的可见性独立。不要把私有仓库的Release写成任何人都能下载，也不要将发行成功当作新增主题兼容验收。

## 工作流顺序与产物

标签/版本检查 → 复用完整`check` → 两个平台分别打包并验收 → 上传Docker Hub → 创建GitHub Release。

- Linux x64、arm64运行包：`leobridge-<版本>-linux-<架构>.tar.gz`、各自`.sha256`和合并的`checksums.txt`。包内包含Node、应用、生产依赖、管理资源、许可证及启停脚本，并非单文件可执行程序。两个平台使用同一确定的Node24版本，下载官方分发包并验证SHA-256。
- 各平台在原生运行器验证实际运行包；启动时PATH不包含系统Node/npm/pnpm，测试默认密码修改、重启后密码持久化及空数据源。两平台还各自构建镜像，用交付Compose模板检查配置预检查、错配拒绝及重建持久化，需要Docker Compose v2。
- Docker镜像：`staractive/leobridge:<版本>`，包含`linux/amd64`及`linux/arm64`。发布后校验架构清单，并按镜像摘要拉取验证。正式版本验证成功后，用同一digest更新`staractive/leobridge:latest`，保留两种架构；带连字符的预发布版本不更新latest。需要固定部署或回退时使用版本标签或摘要。
- Release附带同版本`compose.yaml`；新版不再生成docker.env.example，配置直接写在YAML。工作流新建Release时，说明包含镜像摘要及GitHub生成的改动列表；复用已有Release会保留原说明，需维护者核对并补充镜像信息。发布Actions摘要及Docker Hub标签可用于查询digest。

运行包、镜像及Release均来自同一标签提交。全部检查通过后才进入上传步骤；普通PR不会读取Docker Hub发布凭据。Docker Hub和GitHub Release并非跨平台原子事务：如果镜像已上传而Release步骤失败，先排查并重跑失败任务，不删除数据或擅自重打版本标签。

自动检查使用隔离的合成数据，不访问真实主控、不证明第三方主题兼容或实际部署环境验收。首次使用本工作流前的本地验证不能记作已完成公开发布；实际发布以Actions结果、Release附件及Docker Hub摘要为准。

## 旧工作流报同标签Release已存在

`a release with the same tag name already exists`表示创建Release冲突，不代表前面的运行包或Docker构建失败。新版工作流分页查询含草稿的Release列表，精确匹配标签后复用；查询返回403、服务故障或网络错误时直接失败，只有完整查询成功且无同标签Release才进入创建流程。附件上传失败会保留失败状态，可重跑失败任务补齐；上传不是原子操作。

已触发的旧标签工作流不会因分支上的修复而更新，直接重跑仍会执行旧的创建命令。不要移动标签或删除已有Release来规避。对于已经完成打包和Docker发布的旧运行，可在原Release中补齐该次运行的产物：

1. 从同一次Actions运行下载`release-linux-x64`和`release-linux-arm64`工件，在保留期内解压到同一目录，保留两个`.tar.gz`及其`.sha256`。分别校验两份SHA-256文件，再将两份校验文件合并为`checksums.txt`。
2. 从该标签提交取得`deploy/docker/compose.yaml`，新版不需要独立.env附件；不能混入当前开发分支的文件。
3. 在已有Release的编辑页上传上述7个附件，核对同名附件后替换。保留已有发布说明，并补充该次Docker任务实际输出的镜像标签和digest；保存后检查两种架构的附件及校验文件完整。

这是对已成功构建产物的手动补交，不会使原Actions运行变绿。若工件已过期或无法核实来源，应通过新版本完整发版。新版本标签包含工作流修复后，才会自动使用复用逻辑。
