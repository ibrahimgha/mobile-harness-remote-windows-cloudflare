#!/bin/sh
set -eu

project_root=${1:-/var/www/html/mobile-harness-remote-windows-cloudflare}
service_name=${2:-mobile-harness-remote-windows-cloudflare.service}
port=${3:-8787}
poll_seconds=${POLL_SECONDS:-5}
max_wait_seconds=${MAX_WAIT_SECONDS:-86400}
started_at=$(date +%s)

token=$(sed -n 's/^[[:space:]]*CONTROL_TOKEN[[:space:]]*=[[:space:]]*//p' "$project_root/.env" | tail -n 1)
token=$(printf '%s' "$token" | tr -d '\r')

is_idle() {
  payload=$(curl -fsS --max-time 10 -H "x-control-token: $token" "http://127.0.0.1:$port/api/state") || return 1
  printf '%s' "$payload" | python3 -c '
import json, sys
state = json.load(sys.stdin)
runner = state.get("runner") or {}
active = int(runner.get("activeJobs") or 0)
queued = int(runner.get("queuedJobs") or 0)
raise SystemExit(0 if active == 0 and queued == 0 else 1)
'
}

while :; do
  now=$(date +%s)
  if [ "$max_wait_seconds" -gt 0 ] && [ $((now - started_at)) -ge "$max_wait_seconds" ]; then
    echo "Timed out waiting for an idle Codex Remote; service was not restarted" >&2
    exit 1
  fi

  if is_idle; then
    sleep "$poll_seconds"
    if is_idle; then
      systemctl restart "$service_name"
      sleep 8
      curl -fsS --max-time 10 "http://127.0.0.1:$port/api/health" >/dev/null
      if [ -n "${INSTALL_UNIT:-}" ]; then
        systemctl disable "$INSTALL_UNIT" >/dev/null 2>&1 || true
      fi
      echo "Installed staged Codex Remote release after the machine became idle"
      exit 0
    fi
  fi
  sleep "$poll_seconds"
done
