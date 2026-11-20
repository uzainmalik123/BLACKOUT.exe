#!/usr/bin/env bash
# Setup shared by moves that assume Death already holds an admin session (from ATK-03/ATK-04):
# logs in as the admin straight at the shop (not through nginx), before the recording window,
# and leaves the token in /out/admin.token. Runs inside the rig's tools container only.
set -eu
curl -s -X POST http://10.66.0.20:3000/rest/user/login -H 'Content-Type: application/json' \
  --data-raw '{"email":"admin@juice-sh.op","password":"admin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/' > /out/admin.token
[ -s /out/admin.token ]
