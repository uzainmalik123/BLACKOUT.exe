#!/usr/bin/env bash
# TAP-01's setup (D-135, KI-74): before the scraper comes, the shop has had customers, so its own access log holds
# what they did. CUST.b's shoppers run first, password resets included (their security answers set straight at the
# shop, then the visits through nginx, at 10x speed). Their nginx lines fall before the window, so only the
# scrape is in the recording; what they left in the shop's log is what the scrape takes.
set -eu
python3 /attacks/lib/shoppers.py setup-b http://10.66.0.20:3000
CUST_SCALE=0.1 python3 /attacks/lib/shoppers.py http://10.66.0.10 b
