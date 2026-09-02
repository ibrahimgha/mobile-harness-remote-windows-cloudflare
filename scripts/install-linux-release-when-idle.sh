#!/bin/sh
set -eu

project_root=${1:?project root is required}
service_name=${2:?service name is required}
staged_root=${3:?staged release path is required}
revision=${4:?revision is required}
port=${5:-8787}
poll_seconds=${POLL_SECONDS:-5}
max_wait_seconds=${MAX_WAIT_SECONDS:-0}
started_at=$(date +%s)
runtime_dir="$project_root/.runtime"
log_path="$runtime_dir/install-$revision.log"

mkdir -p "$runtime_dir"

log() {
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$*" >> "$log_path"
}

token=$(sed -n 's/^[[:space:]]*CONTROL_TOKEN[[:space:]]*=[[:space:]]*//p' "$project_root/.env" | tail -n 1)
token=$(printf '%s' "$token" | tr -d '\r' | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')

is_idle() {
  payload=$(curl -fsS --max-time 10 -H "x-control-token: $token" "http://127.0.0.1:$port/api/state") || return 1
  printf '%s' "$payload" | python3 -c '
import json, sys
runner = (json.load(sys.stdin).get("runner") or {})
active = int(runner.get("activeJobs") or 0)
queued = int(runner.get("queuedJobs") or 0)
raise SystemExit(0 if active == 0 and queued == 0 else 1)
'
}

log "queued staged_root=$staged_root service=$service_name"
while :; do
  now=$(date +%s)
  if [ "$max_wait_seconds" -gt 0 ] && [ $((now - started_at)) -ge "$max_wait_seconds" ]; then
    log "timed out waiting for idle state"
    exit 1
  fi

  if is_idle; then
    sleep "$poll_seconds"
    if is_idle; then
      break
    fi
  fi
  sleep "$poll_seconds"
done

log "idle confirmed; installing release"
systemctl stop "$service_name"
cp -a "$staged_root"/. "$project_root"/
printf '%s\n' "$revision" > "$runtime_dir/deployed-revision"
systemctl start "$service_name"

attempt=0
while [ "$attempt" -lt 12 ]; do
  attempt=$((attempt + 1))
  sleep 5
  if curl -fsS --max-time 10 "http://127.0.0.1:$port/api/health" >/dev/null; then
    log "release installed and health check passed"
    rm -rf -- "$staged_root"
    exit 0
  fi
done

log "service failed health verification after install"
exit 1
