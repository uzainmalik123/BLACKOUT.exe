#!/usr/bin/env bash
# ATK-01 variant a: ffuf directory scan of the shop's root with SecLists' common.txt, ffuf's own user
# agent, default 40 threads (loud). Juice Shop answers every unknown path outside /api and /rest with
# its index page (200), so -ac (auto-calibration) is what makes the real hits stand out.
# Runs inside the rig's tools container only (recording/record.sh).
# tool: ffuf 2.1.0
# label: loud: ffuf root scan, common.txt, ffuf user agent
set -eu
ffuf -u http://10.66.0.10/FUZZ -w /wordlists/common.txt -ac -s
