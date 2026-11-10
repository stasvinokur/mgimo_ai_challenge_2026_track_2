#!/bin/sh
set -eu
umask 077

backup_dir=${1:-/backups}
mkdir -p "$backup_dir"
backup_file="$backup_dir/pulse-$(date +%Y%m%d-%H%M%S).dump"
temporary_file="$backup_file.partial"
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM

if ! pg_dump --format=custom --no-owner --no-acl --file="$temporary_file" 2>/dev/null; then
  echo "Не удалось создать резервную копию. Проверьте доступность БД." >&2
  exit 1
fi
mv "$temporary_file" "$backup_file"
find "$backup_dir" -name 'pulse-*.dump' -type f -mmin +10079 -exec rm -f {} \;
echo "Резервная копия создана; копии старше 7 дней удалены."
