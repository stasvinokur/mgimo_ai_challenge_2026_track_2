#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! "${1:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Использование: [DEPLOY_BUILD=1] infra/deploy.sh <полный SHA коммита task-2>.' >&2
  exit 2
fi

image_tag="$1"
host="${VPS_HOST:-pulse-vps}"
if [[ ! "$host" =~ ^[a-zA-Z0-9:][a-zA-Z0-9.:-]*$ ||
      ( -n "${VPS_USER:-}" && ! "$VPS_USER" =~ ^[a-z_][a-z0-9_-]*$ ) ]]; then
  echo 'Проверьте формат VPS_HOST и VPS_USER.' >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
deploy_tmp="$(mktemp -d "${TMPDIR:-/tmp}/pulse-deploy.XXXXXXXX")"
trap 'rm -rf "$deploy_tmp"' EXIT

git -C "$project_root" archive --format=tar "$image_tag" \
  compose.yaml compose.server.yaml infra > "$deploy_tmp/release.tar"
mode=()
if [[ "${DEPLOY_BUILD:-}" == 1 ]]; then
  # CI is off (D-53): the server builds images from the commit tree. Paths in .dockerignore stay at home.
  git -C "$project_root" archive --format=tar "$image_tag" -- . \
    ':(exclude)docs' ':(exclude)backlog' ':(exclude)tests' ':(exclude)tools' ':(exclude).claude' \
    > "$deploy_tmp/source.tar"
  mode=(build)
fi

ssh_options=(-T -o BatchMode=yes -o StrictHostKeyChecking=yes)
if [[ -n "${VPS_USER:-}" ]]; then
  ssh_options+=(-l "$VPS_USER")
fi
if [[ -n "${VPS_SSH_KEY:-}" ]]; then
  printf '%s\n' "$VPS_SSH_KEY" > "$deploy_tmp/id"
  ssh_options+=(-i "$deploy_tmp/id" -o IdentitiesOnly=yes)
fi
if [[ -n "${VPS_SSH_KEY_FILE:-}" ]]; then
  ssh_options+=(-i "$VPS_SSH_KEY_FILE" -o IdentitiesOnly=yes)
fi
if [[ -n "${VPS_KNOWN_HOSTS:-}" ]]; then
  printf '%s\n' "$VPS_KNOWN_HOSTS" > "$deploy_tmp/known_hosts"
  ssh_options+=(-o "UserKnownHostsFile=$deploy_tmp/known_hosts")
elif [[ -n "${VPS_KNOWN_HOSTS_FILE:-}" ]]; then
  ssh_options+=(-o "UserKnownHostsFile=$VPS_KNOWN_HOSTS_FILE")
fi

if [[ -n "${GHCR_READ_TOKEN:-}" ]]; then
  ghcr_user="$(curl --fail --silent --show-error \
    --header "Authorization: Bearer $GHCR_READ_TOKEN" \
    https://api.github.com/user | jq -er '.login')"
  [[ "$ghcr_user" =~ ^[a-zA-Z0-9-]+$ ]]
  printf '%s' "$GHCR_READ_TOKEN" | ssh "${ssh_options[@]}" "$host" \
    "docker login ghcr.io --username '$ghcr_user' --password-stdin" > /dev/null
fi

ssh "${ssh_options[@]}" "$host" \
  'set -eu; umask 077; mkdir -p /opt/pulse; tar -xf - -C /opt/pulse' \
  < "$deploy_tmp/release.tar"
if [[ ${#mode[@]} -gt 0 ]]; then
  ssh "${ssh_options[@]}" "$host" \
    "set -eu; umask 077; rm -rf '/opt/pulse/build/$image_tag'; mkdir -p '/opt/pulse/build/$image_tag'; tar -xf - -C '/opt/pulse/build/$image_tag'" \
    < "$deploy_tmp/source.tar"
fi
# The remote scenario runs from a file, not from stdin: `docker compose exec` reads stdin and would swallow the rest
# of a script fed through `bash -s`, ending the deploy early with status 0.
ssh "${ssh_options[@]}" "$host" \
  "set -eu; umask 077; cat > /opt/pulse/.remote-deploy.sh" \
  < "$project_root/infra/remote-deploy.sh"
ssh "${ssh_options[@]}" "$host" \
  "bash /opt/pulse/.remote-deploy.sh '$image_tag' ${mode[*]:-} < /dev/null"
