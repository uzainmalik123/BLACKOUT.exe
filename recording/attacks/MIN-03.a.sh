#!/usr/bin/env bash
# MIN-03 variant a (PRD §4, REC-05): one wave of the Gnawer, a price scraper hammering the catalogue: GET
# /api/Products (every product, ~30 KB) 30 times, 0.5 s apart (~15 s, one address). No login (Juice Shop serves
# it to anyone). A Scrapy user agent. Sized so customers still write 60 % of the log outside Death's scan
# (SYS-19, D-132). Runs inside the rig's tools container only.
# tool: curl 8.x
# label: scraper wave: GET /api/Products 30 times, 2 a second, Scrapy user agent
set -eu
UA='Scrapy/2.11.2 (+https://scrapy.org)'
for i in $(seq 30); do
  [ "$i" -gt 1 ] && sleep 0.5
  curl -s -o /dev/null -A "$UA" -w "%{http_code} %{size_download}\n" http://10.66.0.10/api/Products
done | sort | uniq -c
