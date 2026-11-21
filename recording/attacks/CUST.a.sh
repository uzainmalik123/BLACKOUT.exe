#!/usr/bin/env bash
# CUST variant a: about ten minutes of ordinary shoppers (REC-06, D-60, D-61), not an attack. 90
# visits from 64 addresses (X-Forwarded-For, D-27) with real browser user agents: browsing, searches,
# guest baskets, logins with the odd typo, baskets, checkouts, sign-ups, feedback and complaints,
# all through the shop's own API the way its front-end calls it. Seeded customers come from
# lib/customers.py. Deterministic (fixed seed). Runs inside the rig's tools container only.
# tool: python3 urllib (lib/shoppers.py)
# label: ordinary customers: ~10 min, 90 visits from 64 addresses, browser user agents
set -eu
python3 /attacks/lib/shoppers.py http://10.66.0.10
