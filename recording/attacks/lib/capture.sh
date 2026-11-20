# Source me from an attack script: `req <curl args> <one URL>` is curl that also keeps the response
# (D-25), so the converter can tell which rows left the building. Each request's body goes to
# /out/responses/NNNN.body and a line `NNNN<TAB>METHOD<TAB>URL<TAB>STATUS` to /out/responses/index.tsv.
# Requests run one at a time, in order; every request of a capturing script must go through req.
req() {
  mkdir -p /out/responses
  local n
  n=$(printf '%04d' $(( $(wc -l < /out/responses/index.tsv 2>/dev/null || echo 0) + 1 )))
  curl -s -o "/out/responses/$n.body" -w "$n\t%{method}\t%{url_effective}\t%{http_code}\n" "$@" >> /out/responses/index.tsv
}
