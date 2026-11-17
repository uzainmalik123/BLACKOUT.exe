#!/usr/bin/env bash
# Proves the rig is isolated before anything attacks it (REC-01). Fails closed: any surprise exits 1.
#   1. the rig network is Docker-internal (no route out, no published ports)
#   2. the tools container reaches the shop through nginx
#   3. the tools container reaches nothing outside the network
set -u
cd "$(dirname "$0")"
fail() { echo "ISOLATION CHECK FAILED: $*" >&2; exit 1; }

internal=$(docker network inspect rec_rec --format '{{.Internal}}' 2>/dev/null) || fail "network rec_rec does not exist (is the rig up?)"
[ "$internal" = "true" ] || fail "network rec_rec is not internal"

run() { docker compose -p rec --profile attack run --rm --no-deps -T tools "$@" 2> >(grep -v "Container rec-tools-run" >&2); }

code=$(run curl -s -o /dev/null -m 5 -w '%{http_code}' http://10.66.0.10/rest/admin/application-version) || true
[ "$code" = "200" ] || fail "shop not reachable through nginx (got '$code')"

for url in https://example.com http://1.1.1.1 http://8.8.8.8; do
  if run curl -s -o /dev/null -m 5 "$url"; then fail "tools container reached $url"; fi
done

echo "isolation ok: rec_rec internal, shop reachable via nginx, no route out"
