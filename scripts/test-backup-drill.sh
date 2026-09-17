#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
source_project="cola-drill-${RANDOM}-$$"
target_project="${source_project}-restore"
cleanup() {
  docker compose -p "$source_project" -f "$tmp/compose.json" down -v --remove-orphans || true
  docker compose -p "$target_project" -f "$tmp/compose.json" down -v --remove-orphans || true
  docker image rm "${source_project}-app" "${source_project}-bike-resolver" || true
  rm -rf "$tmp"
}
trap cleanup EXIT
docker compose -f compose.yaml config --format json > "$tmp/base.json"
python3 - "$tmp" "$source_project" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);c=json.loads((p/'base.json').read_text());c.pop('name',None)
for s in c['services'].values():s.pop('ports',None)
for name in ['app','bike-resolver']:c['services'][name]['image']=sys.argv[2]+'-'+name
for x in ['volumes','networks']:
 for v in c.get(x,{}).values():v.pop('name',None)
(p/'compose.json').write_text(json.dumps(c))
PY
export COLA_COMPOSE_FILES="$tmp/compose.json"
export COMPOSE_PROJECT_NAME="$source_project"
docker compose -f "$tmp/compose.json" up --build -d --wait --wait-timeout 180
docker compose -f "$tmp/compose.json" ps
docker compose -f "$tmp/compose.json" exec -T db psql -U colabike -d colabike -v ON_ERROR_STOP=1 -c "INSERT INTO users(id,email,name,password_hash) VALUES('00000000-0000-4000-8000-000000000001','restore@example.test','Restore marker','hash')"
docker compose -f "$tmp/compose.json" exec -T app sh -c 'printf restore-marker > /app/uploads/drill.webp'
bash scripts/backup-colabike.sh --destination "$tmp/backups" --keep 2
backup=$(find "$tmp/backups" -maxdepth 1 -type d -name 'colabike-*' | head -1)
python3 scripts/backup.py verify --backup "$backup"
export COMPOSE_PROJECT_NAME="$target_project"
bash scripts/restore-colabike.sh --backup "$backup" --yes
count=$(docker compose -f "$tmp/compose.json" exec -T db psql -U colabike -d colabike -Atc "SELECT count(*) FROM users WHERE email='restore@example.test'")
[ "$count" = 1 ]
app=$(docker compose -f "$tmp/compose.json" ps -aq app)
image=$(docker inspect --format '{{.Config.Image}}' "$app")
marker=$(docker run --rm --volumes-from "$app:ro" --entrypoint cat "$image" /app/uploads/drill.webp)
[ "$marker" = restore-marker ]
if bash scripts/restore-colabike.sh --backup "$backup" --yes; then echo 'Restore unexpectedly overwrote existing DB' >&2; exit 1; fi
printf corrupt >> "$backup/photos.tar.gz"
if python3 scripts/backup.py verify --backup "$backup"; then echo 'Corruption undetected' >&2; exit 1; fi
echo 'Backup drill: DB/photos restored into separate project; overwrite and corrupt backup rejected.'
