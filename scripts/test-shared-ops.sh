#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${COLA_TEST_OPS_IMAGE:?Supply the locally built and tested ops image}"
tmp=$(mktemp -d)
project="cola-shared-ops-${RANDOM}-$$"
cleanup() {
  docker compose -p "$project" -f "$tmp/compose.json" down --remove-orphans || true
  docker image rm "${project}-ops:local" || true
  rm -rf "$tmp"
}
trap cleanup EXIT
docker compose -p "$project" -f compose.yaml config --format json > "$tmp/base.json"
python3 - "$tmp" <<'PY'
import json, os, pathlib, sys
p = pathlib.Path(sys.argv[1])
base = json.loads((p / 'base.json').read_text())['services']
# Keep the real producer/consumer image and pull policy. Replace expensive build
# inputs with the CI ops image, and DB-dependent commands with isolated probes.
services = {}
for name in ['migrate', 'chat-sync', 'activity-sync', 'notification-email', 'notification-push', 'bike-week']:
    services[name] = {key: base[name][key] for key in ['image', 'pull_policy']}
services['migrate'].update(build={'context': str(p)}, command=['true'], restart='no')
for name in ['chat-sync', 'activity-sync', 'notification-email', 'notification-push', 'bike-week']:
    services[name].update(command=['node', '-e', 'setInterval(() => {}, 1000)'],
                          depends_on=base[name]['depends_on'])
(p / 'Dockerfile').write_text('FROM ' + os.environ['COLA_TEST_OPS_IMAGE'] + '\n')
(p / 'compose.json').write_text(json.dumps({'services': services}))
PY
if docker image inspect "${project}-ops:local" >/dev/null 2>&1; then
  echo 'Cold-start probe unexpectedly found an existing image' >&2; exit 1
fi
# The docker driver can use the already loaded local ops image as its base.
BUILDX_BUILDER=default docker compose -p "$project" -f "$tmp/compose.json" up --build -d --wait --wait-timeout 60
migrate=$(docker compose -p "$project" -f "$tmp/compose.json" ps -aq migrate)
for name in chat-sync activity-sync notification-email notification-push bike-week; do
  worker=$(docker compose -p "$project" -f "$tmp/compose.json" ps -aq "$name")
  [[ "$(docker inspect --format '{{.Image}}' "$migrate")" == "$(docker inspect --format '{{.Image}}' "$worker")" ]]
  [[ "$(docker inspect --format '{{.State.Running}}' "$worker")" == true ]]
done
echo 'Shared ops: cold up --build creates one local image and starts all worker consumers.'
