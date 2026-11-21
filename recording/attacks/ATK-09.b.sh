#!/usr/bin/env bash
# ATK-09 variant b: scrapes the user list one account at a time, GET /api/Users/<id> for ids 1-163
# (the first half of 325), with a session token (setup: lib/admin-session.sh) and a pause between
# requests, so the half takes 2-3 minutes (D-63). .c is the second half. Juice Shop leaves passwords
# out of these answers, so only emails leave. Runs inside the rig's tools container only.
# tool: curl 8.x
# label: loud: GET /api/Users/<id> one by one for ids 1-163, curl user agent
set -eu
. /attacks/lib/scrape-users.sh
scrape 1 163
