#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
source_project="cola-drill-${RANDOM}-$$"
target_project="${source_project}-restore"
cleanup() {
  docker compose -p "$source_project" -f "$tmp/compose.json" down -v --remove-orphans || true
  docker compose -p "$target_project" -f "$tmp/compose.json" down -v --remove-orphans || true
  if [[ -z "${COLA_TEST_APP_IMAGE:-}" ]]; then
    docker image rm "${source_project}-app" "${source_project}-bike-resolver" || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
if [[ -n "${COLA_TEST_APP_IMAGE:-}" || -n "${COLA_TEST_RESOLVER_IMAGE:-}" ]]; then
  : "${COLA_TEST_APP_IMAGE:?Supply both prebuilt test images}"
  : "${COLA_TEST_RESOLVER_IMAGE:?Supply both prebuilt test images}"
fi
docker compose -f compose.yaml config --format json > "$tmp/base.json"
python3 - "$tmp" "$source_project" <<'PY'
import json, os, pathlib, sys
p = pathlib.Path(sys.argv[1])
c = json.loads((p / 'base.json').read_text())
c.pop('name', None)
for service in c['services'].values():
    service.pop('ports', None)
for name, variable in [('app', 'COLA_TEST_APP_IMAGE'), ('bike-resolver', 'COLA_TEST_RESOLVER_IMAGE')]:
    c['services'][name]['image'] = os.environ.get(variable) or sys.argv[2] + '-' + name
    if os.environ.get(variable):
        c['services'][name].pop('build', None)
for group in ['volumes', 'networks']:
    for value in c.get(group, {}).values():
        value.pop('name', None)
(p / 'compose.json').write_text(json.dumps(c))
PY
export COLA_COMPOSE_FILES="$tmp/compose.json"
export COLA_OPERATIONS_LOCK="$tmp/operations.lock"
export COMPOSE_PROJECT_NAME="$source_project"
if [[ -z "${COLA_TEST_APP_IMAGE:-}" ]]; then
  docker compose -f "$tmp/compose.json" build
fi
# Pin the same final images throughout restore. Its normal --build option must
# not rebuild the application or resolver in this disposable image-only topology.
python3 - "$tmp/compose.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
c = json.loads(p.read_text())
for service in c['services'].values():
    service.pop('build', None)
p.write_text(json.dumps(c))
PY
docker compose -f "$tmp/compose.json" up --no-build -d --wait --wait-timeout 180
docker compose -f "$tmp/compose.json" ps
docker compose -f "$tmp/compose.json" exec -T -e COLA_DISPOSABLE_RUNTIME_TEST=1 app node --input-type=module - < tests/runtime-image.js
docker compose -f "$tmp/compose.json" exec -T bike-resolver node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
assert.notEqual(process.getuid(), 0);
for (const file of ['tests', 'scripts', 'src', 'docs'])
  await assert.rejects(access(file), { code: 'ENOENT' });
assert.equal((await fetch('http://localhost:8080/ready')).status, 200);
JS
docker compose -f "$tmp/compose.json" exec -T db psql -U colabike -d colabike -v ON_ERROR_STOP=1 -c "INSERT INTO users(id,email,name,password_hash) VALUES('00000000-0000-4000-8000-000000000001','restore@example.test','Restore marker','hash')"
docker compose -f "$tmp/compose.json" exec -T app sh -c 'printf restore-marker > /app/uploads/drill.webp'
docker compose -f "$tmp/compose.json" exec -T db psql -U colabike -d colabike -v ON_ERROR_STOP=1 -c "UPDATE users SET avatar_id='00000000-0000-4000-8000-000000000002',avatar_size_bytes=13 WHERE email='restore@example.test'"
docker compose -f "$tmp/compose.json" exec -T app sh -c 'printf avatar-marker > /app/uploads/avatar-00000000-0000-4000-8000-000000000002.webp'
docker compose -f "$tmp/compose.json" exec -T -w /app/scripts app node --input-type=module - --seed < scripts/ride-backup-drill.js
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
avatar=$(docker run --rm --volumes-from "$app:ro" --entrypoint cat "$image" /app/uploads/avatar-00000000-0000-4000-8000-000000000002.webp)
[ "$avatar" = avatar-marker ]
avatar_id=$(docker compose -f "$tmp/compose.json" exec -T db psql -U colabike -d colabike -Atc "SELECT avatar_id FROM users WHERE email='restore@example.test'")
[ "$avatar_id" = 00000000-0000-4000-8000-000000000002 ]
docker compose -f "$tmp/compose.json" up --no-build -d --wait --wait-timeout 180
docker compose -f "$tmp/compose.json" exec -T -w /app/scripts app node --input-type=module - --verify < scripts/ride-backup-drill.js
if bash scripts/restore-colabike.sh --backup "$backup" --yes; then echo 'Restore unexpectedly overwrote existing DB' >&2; exit 1; fi
printf corrupt >> "$backup/photos.tar.gz"
if python3 scripts/backup.py verify --backup "$backup"; then echo 'Corruption undetected' >&2; exit 1; fi
echo 'Backup drill: final images and migrations checked; DB/photos/avatars/rides restored; overwrite and corrupt backup rejected.'
