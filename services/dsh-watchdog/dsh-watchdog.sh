#!/bin/bash
# dsh-watchdog: check PC bridge via heartbeat file; notify on up/down transitions.
# Runs on VPS every 5 min via cron. Notifies via Telegram sendMessage (bot token only).
set -u
TOKEN_FILE=/etc/dsh-watchdog/bot_token
STATE_FILE=/var/lib/dsh-watchdog/state
HEARTBEAT=/var/backups/dsh/heartbeat.txt
LOG_FILE=/var/log/dsh-watchdog.log
CHAT_ID=8692341924
STALE_SEC=420
log() { echo "$(date '+%F %T') $*" >> "$LOG_FILE"; }
CUR="down"; REASON=""
if [ -f "$HEARTBEAT" ]; then
  HB_STATUS=$(awk '{print $1}' "$HEARTBEAT" 2>/dev/null)
  HB_EPOCH=$(awk '{print $2}' "$HEARTBEAT" 2>/dev/null)
  if [ -n "$HB_EPOCH" ] && [ "$HB_EPOCH" -gt 0 ] 2>/dev/null; then
    NOW=$(date +%s)
    AGE=$((NOW - HB_EPOCH))
    if [ "$AGE" -le "$STALE_SEC" ]; then
      if [ "$HB_STATUS" = "active" ]; then CUR="up"; REASON="bridge active (heartbeat ${AGE}s old)"; else CUR="down"; REASON="bridge status=$HB_STATUS (heartbeat ${AGE}s old)"; fi
    else
      CUR="down"; REASON="heartbeat stale (${AGE}s old)"
    fi
  else
    CUR="down"; REASON="heartbeat timestamp unreadable"
  fi
else
  CUR="down"; REASON="heartbeat file missing"
fi
PREV=$(cat "$STATE_FILE" 2>/dev/null || echo "unknown")
log "check: cur=$CUR prev=$PREV ($REASON)"
if [ "$PREV" = "unknown" ]; then
  echo "$CUR" > "$STATE_FILE"
  log "init state=$CUR (no notification on first run)"
  exit 0
fi
if [ "$CUR" != "$PREV" ]; then
  echo "$CUR" > "$STATE_FILE"
  if [ "$CUR" = "down" ]; then
    MSG="【看门狗】DSH 桥掉线了：$REASON。Bot 暂时回不了消息。恢复后我再通知你。"
  else
    MSG="【看门狗】DSH 桥恢复了：桥已回到 active，Bot 可以正常回复了。"
  fi
  if [ -f "$TOKEN_FILE" ]; then
    TOKEN=$(cat "$TOKEN_FILE")
    RESP=$(curl -s -m 15 "https://api.telegram.org/bot${TOKEN}/sendMessage" -d "chat_id=$CHAT_ID" --data-urlencode "text=$MSG" 2>/dev/null)
    case "$RESP" in
      *'"ok":true'*) log "notified ($CUR): sendMessage ok" ;;
      *) log "notified ($CUR): sendMessage FAILED resp=${RESP:0:120}" ;;
    esac
  else
    log "notified ($CUR): SKIPPED, token file missing"
  fi
fi
exit 0
