#!/bin/bash
# dsh-heartbeat: check bridge, push status+epoch+ISO time to VPS (every 2 min).
# Read by the VPS watchdog. No credentials here.
set -u
VPS_USER=dshbackup
VPS_HOST=100.98.210.47
KEY=/root/.ssh/id_dsh_backup
SSH_OPTS="-i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/root/.ssh/known_hosts"
STATUS=$(systemctl is-active localagent-dsh-bridge 2>/dev/null || true)
if [ -z "$STATUS" ]; then STATUS="inactive"; fi
EPOCH=$(date +%s)
ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '%s %s %s\n' "$STATUS" "$EPOCH" "$ISO" | ssh $SSH_OPTS "$VPS_USER@$VPS_HOST" 'umask 077; cat > /var/backups/dsh/heartbeat.txt'
exit 0
