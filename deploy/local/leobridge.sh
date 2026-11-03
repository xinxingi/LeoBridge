#!/usr/bin/env bash
# Run an existing distribution. Never download, install dependencies, or build here.
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# The source checkout stores this launcher under deploy/local; releases put it at the root.
if [[ "$ROOT" == */deploy/local ]] && [ ! -f "$ROOT/release.json" ] && [ -f "$ROOT/../../scripts/local-service.ts" ] && [ -f "$ROOT/../../package.json" ]; then
  ROOT="$(cd -- "$ROOT/../.." && pwd -P)"
fi
cd "$ROOT"
COMMAND="${1:-start}"
case "$COMMAND" in
  start|stop|restart|status|logs) ;;
  help|-h|--help)
    echo "用法: ${BASH_SOURCE[0]} [start|stop|restart|status|logs] [--quiet]"
    echo '直接运行已构建程序，默认后台启动；不安装依赖或编译。'
    exit 0 ;;
  *) echo "不支持的命令: $COMMAND。用户请下载完整运行包；源码构建见 docs/development/build.md。" >&2; exit 2 ;;
esac
if [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$2" != '--quiet' ]; }; then
  echo '可选参数仅支持 --quiet。' >&2; exit 2
fi
valid_node() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; }
if [ -d "$ROOT/runtime" ] || [ -f "$ROOT/release.json" ]; then
  NODE="$ROOT/runtime/bin/node"
  valid_node "$NODE" || { echo '运行包的 Node 不可用，请重新下载与系统/架构匹配的完整运行包。' >&2; exit 1; }
elif command -v node >/dev/null 2>&1 && valid_node "$(command -v node)"; then
  NODE="$(command -v node)"
else
  echo '请下载自带 Node 的完整运行包。开发者自行构建请参考 docs/development/build.md。' >&2; exit 1
fi
[ -f "$ROOT/dist/local-service.js" ] || { echo '缺少已构建的管理程序。请重新解压完整运行包；源码构建见 docs/development/build.md。' >&2; exit 1; }
export PATH="$(dirname "$NODE"):$PATH"
exec "$NODE" "$ROOT/dist/local-service.js" "$COMMAND" "${2:-}"
