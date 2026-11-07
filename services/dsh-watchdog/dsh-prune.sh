#!/bin/bash
# dsh-prune: delete DSH backup snapshots older than 7 days.
find /var/backups/dsh -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -mtime +7 -exec rm -rf {} +
exit 0
