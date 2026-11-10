#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 || $# -gt 2 || ! "${1:-}" =~ ^[0-9a-f]{40}$ || ( $# -eq 2 && "$2" != build ) ]]; then
  echo 'Нужен полный SHA коммита для деплоя и необязательный режим build.' >&2
  exit 2
fi

trap 'echo "Ошибка деплоя. Проверьте docker compose ps --all в /opt/pulse и /opt/edge; для отката запустите infra/deploy.sh с предыдущим SHA (docs/DEPLOY.md)." >&2' ERR
cd /opt/pulse
export IMAGE_TAG="$1"
export COMPOSE_FILE=compose.yaml:compose.server.yaml
test -f .env
app_domain="$(sed -n 's/^APP_DOMAIN=//p' .env | tail -n 1)"
[[ "$app_domain" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]]
# Folder of a shared domain (D-54): empty — the app owns the whole domain; /dekanat — only that folder.
base_path="$(sed -n 's/^BASE_PATH=//p' .env | tail -n 1)"
[[ -z "$base_path" || "$base_path" =~ ^/[a-z0-9][a-z0-9-]*$ ]]

edge() {
  env -u COMPOSE_FILE -u COMPOSE_PROFILES -u IMAGE_TAG -u IMAGE_REPO \
    docker compose --project-directory /opt/edge -f /opt/edge/compose.yaml "$@"
}

# Shared entry proxy (D-53): installed once from infra/edge, afterwards owned by the server, not by this project.
docker network inspect edge > /dev/null 2>&1 || docker network create edge > /dev/null
if [[ ! -f /opt/edge/compose.yaml ]]; then
  mkdir -p /opt/edge/sites
  cp infra/edge/compose.yaml infra/edge/Caddyfile /opt/edge/
fi
mkdir -p /opt/edge/routes /opt/edge/www
# Folders of a shared domain need the routes/ and www/ mounts; an older edge stack gets them once (additive change).
if [[ -n "$base_path" ]] && ! grep -q './routes:/etc/caddy/routes' /opt/edge/compose.yaml; then
  cp infra/edge/compose.yaml /opt/edge/compose.yaml
fi

if [[ "${2:-}" == build ]]; then
  # CI is off (D-53): build images from the delivered commit tree; reuse them on rollback.
  export IMAGE_REPO=pulse
  build_dir="/opt/pulse/build/$IMAGE_TAG"
  built_base="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "pulse/app:$IMAGE_TAG" 2>/dev/null | sed -n 's/^BASE_PATH=//p' || true)"
  if ! docker image inspect "pulse/app:$IMAGE_TAG" "pulse/migrator:$IMAGE_TAG" "pulse/tts:$IMAGE_TAG" > /dev/null 2>&1 \
    || [[ "$built_base" != "$base_path" ]]; then
    test -f "$build_dir/Dockerfile"
    (cd "$build_dir" && docker compose --env-file /opt/pulse/.env --profile tts build migrate app tts)
  fi
else
  export IMAGE_REPO=ghcr.io/trade-stasvinokur/mgimo-pulse
  docker compose config --quiet
  docker compose pull
fi

docker compose config --quiet
docker compose up -d --no-build --wait --wait-timeout 300

edge up -d --wait --wait-timeout 120
# Files this deploy may change. Each is restored if the new configuration does not validate.
domain_site="/opt/edge/sites/$app_domain.caddy"
route="/opt/edge/routes/$app_domain/pulse.caddy"
landing="/opt/edge/www/$app_domain/index.html"
root_worker="/opt/edge/www/$app_domain/sw.js"
managed=(/opt/edge/sites/pulse.caddy "$domain_site" "$route" "$landing" "$root_worker")
mkdir -p "/opt/edge/routes/$app_domain" "/opt/edge/www/$app_domain"
# Backups stay outside /opt/edge/www, which Caddy serves to anyone.
backup_dir="$(mktemp -d /opt/edge/.deploy-backup.XXXXXX)"
for index in "${!managed[@]}"; do
  if [[ -f "${managed[$index]}" ]]; then cp "${managed[$index]}" "$backup_dir/$index"; fi
done
restore_edge() {
  for index in "${!managed[@]}"; do
    if [[ -f "$backup_dir/$index" ]]; then cp "$backup_dir/$index" "${managed[$index]}"; else rm -f "${managed[$index]}"; fi
  done
}
if [[ -z "$base_path" ]]; then
  sed "s/__APP_DOMAIN__/$app_domain/g" infra/edge/sites/pulse.caddy > /opt/edge/sites/pulse.caddy
else
  # The domain is shared: the whole-domain site file goes away, the domain file and the landing page are installed
  # once and then belong to the server, and the folder route is ours.
  rm -f /opt/edge/sites/pulse.caddy
  [[ -f "$domain_site" ]] || sed "s/__APP_DOMAIN__/$app_domain/g" infra/edge/domain.caddy > "$domain_site"
  [[ -f "$landing" ]] || cp infra/edge/www/index.html "$landing"
  [[ -f "$root_worker" ]] || cp infra/edge/www/sw.js "$root_worker"
  sed "s|__BASE_PATH__|$base_path|g" infra/edge/routes/pulse.caddy > "$route"
fi
if ! edge exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null; then
  restore_edge
  rm -rf "$backup_dir"
  echo 'Конфигурация общего Caddy не прошла проверку, прежние файлы сайта восстановлены.' >&2
  exit 1
fi
edge exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
rm -rf "$backup_dir"

app_url="https://$app_domain$base_path"
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-all-errors \
  --connect-timeout 10 --max-time 20 "$app_url/api/health" \
  | grep -Eq '"status": ?"ok"'
# /login renders, and a public stand shows no demo passwords (D-52): a typo in DEMO_LOGIN_HINTS breaks only this page.
login_page="$(curl --fail --silent --show-error --connect-timeout 10 --max-time 20 "$app_url/login")"
grep -q 'name="password"' <<< "$login_page"
if grep -q '^DEMO_LOGIN_HINTS=off$' .env && grep -qE 'demo-2026|Войти как' <<< "$login_page"; then
  echo 'На стенде с DEMO_LOGIN_HINTS=off экран входа показывает демо-пароли.' >&2
  exit 1
fi
if [[ -n "$base_path" ]]; then
  curl --fail --silent --show-error --connect-timeout 10 --max-time 20 "https://$app_domain/" > /dev/null
fi
if test -f .deployed-tag; then
  cp .deployed-tag .previous-tag
fi
printf '%s\n' "$IMAGE_TAG" > .deployed-tag
# Plain `docker compose ...` in /opt/pulse keeps working with the deployed images.
sed -i -e "s|^IMAGE_TAG=.*|IMAGE_TAG=$IMAGE_TAG|" -e "s|^IMAGE_REPO=.*|IMAGE_REPO=$IMAGE_REPO|" .env
if [[ "${2:-}" == build ]]; then
  rm -rf "$build_dir"
  # Keep the deployed and the previous tag for a fast rollback; older locally built images only take disk space.
  previous_tag="$(cat .previous-tag 2>/dev/null || true)"
  docker images --format '{{.Repository}}:{{.Tag}}' --filter 'reference=pulse/*' | while read -r image; do
    case "${image##*:}" in
      "$IMAGE_TAG" | "$previous_tag") ;;
      *) docker image rm "$image" < /dev/null > /dev/null || echo "Не удалось удалить старый образ $image." >&2 ;;
    esac
  done
fi
echo 'Деплой завершён, HTTPS health отвечает успешно.'
