#!/bin/sh
set -eu

case "${1-}" in
  ''|*[!0-9]*) echo 'Укажите числовой ID worktree: scripts/wt-db.sh 42' >&2; exit 1 ;;
esac
if [ "$#" -ne 1 ] || [ "${#1}" -gt 9 ]; then
  echo 'Нужен один числовой ID длиной до 9 цифр.' >&2
  exit 1
fi
: "${DATABASE_URL:?Задайте DATABASE_URL с правом CREATE DATABASE.}"
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

node --input-type=module - "$1" <<'NODE'
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

async function main() {
  const id = process.argv[2];
  if (!/^[0-9]{1,9}$/.test(id)) throw new Error('Некорректный ID.');
  const name = `pulse_wt_${id}`;
  const target = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('Некорректный адрес БД.');
  const admin = new URL(target);
  admin.pathname = '/postgres';
  target.pathname = `/${name}`;
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const exists = await sql`select 1 from pg_database where datname = ${name}`;
    if (exists.length === 0) await sql`create database ${sql(name)}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
  for (const command of ['db:migrate', 'db:seed']) {
    const result = spawnSync('pnpm', [command], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: target.toString() } });
    if (result.error || result.status !== 0) throw new Error('Служебная команда завершилась ошибкой.');
  }
  console.info(`БД ${name} готова. Для worktree используйте это имя БД в DATABASE_URL и отдельный PORT.`);
}
main().catch(() => { console.error('Не удалось подготовить БД worktree. Проверьте PostgreSQL и право CREATE DATABASE.'); process.exitCode = 1; });
NODE
