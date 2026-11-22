#!/usr/bin/env bash
# CUST variant b (KI-82): about three minutes of ordinary shoppers, not an attack. 24 visits from 20
# addresses (X-Forwarded-For, D-27) with real browser user agents: browsing, searches, baskets, a checkout,
# and what CUST.a never shows: five forgot-password resets (a mistyped security answer first; one gives up)
# and five visits to /ftp (the About page's Terms of Use, /ftp/legal.md; one opens /ftp itself).
# Deterministic (fixed seed). Runs inside the rig's tools container only.
# tool: python3 urllib (lib/shoppers.py)
# label: ordinary customers: ~3 min, 24 visits from 20 addresses, password resets and /ftp, browser user agents
set -eu
python3 /attacks/lib/shoppers.py http://10.66.0.10 b
