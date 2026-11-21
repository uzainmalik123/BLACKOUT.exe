#!/usr/bin/env bash
# ATK-09 variant c: scrapes the user list one account at a time, GET /api/Users/<id> for ids 164-325
# (the second half of 325), with a session token (setup: lib/admin-session.sh) and a pause between
# requests, so the half takes 2-3 minutes (D-63). .b is the first half. Juice Shop leaves passwords
# out of these answers, so only emails leave. Runs inside the rig's tools container only.
# tool: curl 8.x
# label: loud: GET /api/Users/<id> one by one for ids 164-325, curl user agent
set -eu
. /attacks/lib/scrape-users.sh
scrape 164 325
