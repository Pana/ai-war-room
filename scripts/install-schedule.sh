#!/bin/zsh
# 安装 / 卸载每日定时采集（macOS launchd，用户级，不需要管理员权限）。
#   安装：scripts/install-schedule.sh            默认每天 08:00
#   改时间：scripts/install-schedule.sh 7 30      每天 07:30
#   卸载：scripts/install-schedule.sh uninstall
#
# 电脑在 08:00 处于睡眠时，launchd 会在唤醒后补跑一次；关机则跳过当天。

set -eu
LABEL="com.ai-zuozhanshi.collect"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="${0:A:h:h}"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载定时采集"
  exit 0
fi

HOUR="${1:-8}"
MINUTE="${2:-0}"
chmod +x "$PROJECT_DIR/scripts/daily.sh"
mkdir -p "$PROJECT_DIR/data/logs" "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$PROJECT_DIR/scripts/daily.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$PROJECT_DIR/data/logs/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_DIR/data/logs/launchd.log</string>
</dict>
</plist>
EOF

# 重新加载（已装过的先卸下）
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
printf '已安装：每天 %02d:%02d 自动采集\n' "$HOUR" "$MINUTE"
echo "日志：$PROJECT_DIR/data/logs/"
echo "立即跑一次：launchctl kickstart $DOMAIN/$LABEL"
