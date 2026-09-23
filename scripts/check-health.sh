#!/usr/bin/env bash
# Host-side health check for cron or a push monitor. Prints one line per check
# and exits 1 when anything needs attention. It only reads state.
#
#   COLA_URL=https://colabike.ru COLA_BACKUP_DIR=/srv/colabike-backups \
#     bash scripts/check-health.sh
#
# Optional: COLA_TLS_MIN_DAYS (14), COLA_DISK_MAX_PERCENT (85), COLA_DISK_PATHS ("/"),
# COLA_BACKUP_MAX_AGE_HOURS (26), COLA_5XX_MAX (20 per 15 minutes; needs Docker
# access and the same COLA_COMPOSE_FILES/COLA_ENV_FILE as backup.py).
set -uo pipefail

url=${COLA_URL:-https://colabike.ru}
tls_min_days=${COLA_TLS_MIN_DAYS:-14}
disk_max=${COLA_DISK_MAX_PERCENT:-85}
backup_dir=${COLA_BACKUP_DIR:-}
backup_max_hours=${COLA_BACKUP_MAX_AGE_HOURS:-26}
errors_max=${COLA_5XX_MAX:-20}
failed=0

ok() { printf 'OK     %s\n' "$*"; }
alert() {
  printf 'ALERT  %s\n' "$*"
  failed=1
}

status=$(curl --silent --show-error --fail --max-time 10 "$url/api/status" 2>&1)
if [[ $? -ne 0 ]]; then
  alert "status: $url/api/status is unreachable ($status)"
elif ! grep -q '"database":true' <<<"$status"; then
  alert "status: database is not ready ($status)"
elif ! grep -q '"resolver":true' <<<"$status"; then
  alert "status: Resolver is unavailable; manual bike entry still works"
else
  ok "status: application, database and Resolver respond"
fi

host=$(sed -E 's#^[a-z]+://([^/:]+).*#\1#' <<<"$url")
if [[ $url == https://* ]]; then
  expiry=$(echo | timeout 15 openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [[ -z $expiry ]]; then
    alert "tls: could not read the certificate of $host"
  else
    days=$(( ($(date -d "$expiry" +%s) - $(date +%s)) / 86400 ))
    if (( days < tls_min_days )); then
      alert "tls: certificate of $host expires in $days days"
    else
      ok "tls: certificate valid for $days days"
    fi
  fi
fi

for path in ${COLA_DISK_PATHS:-/}; do
  used=$(df --output=pcent "$path" 2>/dev/null | tail -1 | tr -dc '0-9')
  if [[ -z $used ]]; then
    alert "disk: cannot read usage of $path"
  elif (( used > disk_max )); then
    alert "disk: $path is $used% full (limit $disk_max%)"
  else
    ok "disk: $path is $used% full"
  fi
done

if [[ -n $backup_dir ]]; then
  latest=$(find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name 'colabike-*' \
    -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1)
  if [[ -z $latest ]]; then
    alert "backup: no colabike-* backup in $backup_dir"
  else
    age=$(( ($(date +%s) - ${latest%%.*}) / 3600 ))
    if (( age > backup_max_hours )); then
      alert "backup: newest backup is $age hours old (${latest#* })"
    else
      ok "backup: newest backup is $age hours old"
    fi
  fi
fi

if [[ -n ${COLA_COMPOSE_FILES:-} ]]; then
  compose=(docker compose)
  [[ -n ${COLA_ENV_FILE:-} ]] && compose+=(--env-file "$COLA_ENV_FILE")
  for file in $COLA_COMPOSE_FILES; do compose+=(-f "$file"); done
  logs=$("${compose[@]}" logs --no-log-prefix --since 15m app 2>/dev/null)
  if [[ $? -ne 0 ]]; then
    alert "logs: cannot read app logs through docker compose"
  else
    count=$(grep -c '"event":"request_failed"' <<<"$logs")
    if (( count > errors_max )); then
      alert "logs: $count failed requests (5xx) in 15 minutes"
    else
      ok "logs: $count failed requests (5xx) in 15 minutes"
    fi
  fi
fi

exit "$failed"
