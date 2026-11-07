#!/bin/bash
# dsh-backup: nightly backup of DSH workspace + baseline log + bridge code + dsh-home (PC -> VPS).
# dsh-home holds official-DSH state (sessions, sdk profile, plugins). No credentials live there.
# Copies ONLY the 4 listed sources; agent.env (credentials) and dsh-venv are never included.
set -u
LOG=/var/log/dsh-backup.log
VPS_USER=dshbackup
VPS_HOST=100.98.210.47
VPS_DIR=/var/backups/dsh
KEY=/root/.ssh/id_dsh_backup
SSH_OPTS="-i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh/known_hosts"
TODAY=$(date +%F)
log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
log "backup start (snapshot $TODAY)"
PREV=$(ssh $SSH_OPTS "$VPS_USER@$VPS_HOST" "ls -d $VPS_DIR/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9] 2>/dev/null | grep -v $TODAY | sort | tail -1" 2>/dev/null)
LINKDEST=""
if [ -n "$PREV" ]; then LINKDEST="--link-dest=$PREV"; log "link-dest: $PREV"; else log "link-dest: none (first run)"; fi
rsync -a --delete --exclude='__pycache__' $LINKDEST \
  -e "ssh $SSH_OPTS" \
  /opt/localagent/dsh-workspace \
  /opt/localagent/logs/dsh-baseline.jsonl \
  /opt/localagent/dsh-bridge \
  /opt/localagent/dsh-home \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/$TODAY/" >>"$LOG" 2>&1
RC=$?
if [ $RC -ne 0 ]; then log "rsync FAILED (exit $RC)"; exit $RC; fi
ssh $SSH_OPTS "$VPS_USER@$VPS_HOST" "ln -sfn $VPS_DIR/$TODAY $VPS_DIR/latest" >>"$LOG" 2>&1
log "backup OK (snapshot $TODAY)"
exit 0
