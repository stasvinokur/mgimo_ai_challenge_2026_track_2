#!/bin/sh
set -eu
mkdir -p /backups
chmod 700 /backups
exec crond -f -l 8 -L /dev/stdout -c /etc/crontabs
