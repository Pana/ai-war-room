#!/bin/zsh
# 每日采集：由 launchd 定时调用（见 scripts/install-schedule.sh），也可以手动运行。
# launchd 不会加载你的 shell 配置，所以 Node 路径和代理都要在这里自己设。

set -u
PROJECT_DIR="${0:A:h:h}"
LOG_DIR="$PROJECT_DIR/data/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/collect-$(date +%Y-%m-%d).log"

# Node：用 nvm 的默认版本
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

# 代理：本机的代理客户端（默认端口 7890）。没开代理时 Hugging Face、YouTube 等会失败。
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
export HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}"
export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1,.local}"

cd "$PROJECT_DIR" || exit 1
{
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') 开始 ===="
  if ! command -v npm >/dev/null; then
    echo "找不到 npm，检查 nvm 是否安装在 $NVM_DIR"
    exit 1
  fi
  npm run collect 2>&1 | grep -v '^npm warn'
  code=${pipestatus[1]}
  echo "==== $(date '+%Y-%m-%d %H:%M:%S') 结束，退出码 $code ===="
} >>"$LOG" 2>&1

# 日志只留 30 天
find "$LOG_DIR" -name 'collect-*.log' -mtime +30 -delete 2>/dev/null
exit ${code:-1}
