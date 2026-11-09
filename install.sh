#!/bin/sh
set -eu

usage() {
  cat <<'HELP'
喜马拉雅 CLI 安装器（macOS / Linux，Node.js 22+ 与 npm；远端安装需 Git）

用法：sh install.sh [--ref 分支/标签/提交] [--prefix 安装前缀] [--source 本地目录或包]

默认通过 Git HTTPS 从 GitHub main 分支安装整个 xmly CLI，包括该版本内置技能文件。
  --ref REF       选择 GitHub 分支、标签或提交，默认 main
  --prefix DIR    自定义 npm 全局安装前缀，避免系统目录权限问题
  --source SPEC   安装指定的本地源码目录或 .tgz，不能与 --ref 同用
  --help          显示帮助

安装不会登录账号、安装 Agent 技能或修改 shell 配置。
HELP
}

install_ref=main
install_source=
install_prefix=
ref_set=false
source_set=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --ref|--prefix|--source)
      option=$1
      [ "$#" -ge 2 ] && [ -n "$2" ] || { printf '%s\n' "参数 $option 需要非空值" >&2; exit 1; }
      case "$option" in
        --ref) install_ref=$2; ref_set=true ;;
        --prefix) install_prefix=$2 ;;
        --source) install_source=$2; source_set=true ;;
      esac
      shift 2 ;;
    *) printf '%s\n' "未知参数：$1；使用 --help 查看" >&2; exit 1 ;;
  esac
done
if [ "$ref_set" = true ] && [ "$source_set" = true ]; then
  printf '%s\n' '--ref 与 --source 不能同时使用' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' '请先安装 Node.js 22+（包含 npm），再运行安装命令：https://nodejs.org/' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  printf '%s\n' 'xmly 需要 Node.js 22+，请升级后重试。' >&2
  exit 1
fi
install_temp=
cleanup() { if [ -n "$install_temp" ]; then rm -rf "$install_temp"; fi; }
trap cleanup 0
trap 'exit 1' HUP INT TERM
if [ "$source_set" = false ] || [ -d "$install_source" ]; then
  install_temp=$(mktemp -d "${TMPDIR:-/tmp}/xmly-install.XXXXXXXX")
fi
if [ "$source_set" = false ]; then
  if ! command -v git >/dev/null 2>&1; then
    printf '%s\n' '从 GitHub 安装需要 Git；请安装 Git，或使用 --source 指定本地 .tgz 包。' >&2
    exit 1
  fi
  case "$install_ref" in
    -*|*[!a-zA-Z0-9._/-]*) printf '%s\n' '--ref 不能以横线开头，且仅支持字母、数字、点、下划线、斜杠和横线' >&2; exit 1 ;;
  esac
  git clone --quiet https://github.com/deluxebear/ximalayacli.git "$install_temp/source"
  git -C "$install_temp/source" checkout --quiet "$install_ref"
  install_source="$install_temp/source"
fi
if [ -d "$install_source" ]; then
  (cd "$install_source" && npm pack --ignore-scripts --json --pack-destination "$install_temp") > "$install_temp/pack.json"
  install_source=$(node -e '
    const fs = require("node:fs"), path = require("node:path");
    const result = JSON.parse(fs.readFileSync(path.join(process.argv[1], "pack.json"), "utf8"));
    if (result.length !== 1 || !result[0].filename || path.basename(result[0].filename) !== result[0].filename) throw new Error("无效打包结果");
    process.stdout.write(path.join(process.argv[1], result[0].filename));
  ' -- "$install_temp")
elif [ ! -f "$install_source" ]; then
  printf '%s\n' '--source 必须是存在的本地源码目录或 .tgz 文件' >&2
  exit 1
fi
printf '%s\n' '正在安装完整 xmly CLI…'
if [ -n "$install_prefix" ]; then
  npm install --global --no-audit --no-fund --prefix "$install_prefix" -- "$install_source"
  global_prefix=$(npm prefix --global --prefix "$install_prefix")
else
  npm install --global --no-audit --no-fund -- "$install_source"
  global_prefix=$(npm prefix --global)
fi
if [ ! -f "$global_prefix/lib/node_modules/ximalaya-studio-cli/bin/xmly.mjs" ] || [ ! -x "$global_prefix/bin/xmly" ]; then
  printf '%s\n' 'npm 已返回，但 xmly 文件或命令入口缺失，请检查安装前缀。' >&2
  exit 1
fi
if [ -n "$install_prefix" ]; then
  printf '%s\n' '安装完成。请将以下目录加入 PATH（若尚未加入）：' "$install_prefix/bin"
else
  printf '%s\n' '安装完成。若找不到 xmly，请将 npm 全局安装前缀下的 bin 目录加入 PATH。'
fi
printf '%s\n' '检查安装：xmly --help' '首次登录：xmly auth login' '按需安装 Agent 技能：xmly skills install'
