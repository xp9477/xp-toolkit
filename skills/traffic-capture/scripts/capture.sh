#!/bin/sh
set -eu

ACTION="${1:-status}"
IMAGE="mitmproxy/mitmproxy@sha256:68afa70d7b6ac9d269b88f88534f9ffceb363b4ce31703a78702341fba82e831"

case "$ACTION" in
  start|stop|status) ;;
  *) echo "usage: capture.sh start|stop|status" >&2; exit 2 ;;
esac

run_remote() {
  host="$1"
  ssh -o BatchMode=yes -o ConnectTimeout=4 -o StrictHostKeyChecking=accept-new "root@${host}" "ACTION='${ACTION}' IMAGE='${IMAGE}' sh -s" << 'REMOTE'
set -eu
BASE=/etc/mitmproxy-capture
case "$ACTION" in
  start)
    if docker ps --filter name=xp-capture-proxy --filter status=running -q | grep -q .; then
      echo already-running
      docker ps --filter name=xp-capture-proxy --format '{{.Status}}'
      exit 0
    fi
    docker rm -f xp-capture-proxy >/dev/null 2>&1 || true
    umask 077
    mkdir -p "$BASE/conf" "$BASE/data"
    STAMP=$(date +%Y%m%d-%H%M%S)
    FILE="session-${STAMP}.flow"
    printf '%s\n' "$FILE" > "$BASE/data/current-session"
    cat > "$BASE/conf/run.sh" << 'RUN'
#!/bin/sh
set -eu
umask 077
AUTH=$(cat /conf/proxy-auth)
FILE=$(cat /data/current-session)
exec mitmdump --mode regular@0.0.0.0:8898 --set confdir=/conf --set flow_detail=0 --proxyauth "$AUTH" -q -w "/data/$FILE"
RUN
    chmod 700 "$BASE/conf/run.sh"
    docker run -d --name xp-capture-proxy --network host --restart no --memory 256m \
      -v "$BASE/conf:/conf" \
      -v "$BASE/data:/data" \
      --entrypoint /conf/run.sh \
      "$IMAGE" >/dev/null
    sleep 1
    echo started
    echo "file=$BASE/data/$FILE"
    docker ps --filter name=xp-capture-proxy --format '{{.Status}}'
    netstat -ln 2>/dev/null | grep 8898 || true
    ;;
  stop)
    FILE=""
    if [ -s "$BASE/data/current-session" ]; then
      FILE=$(cat "$BASE/data/current-session")
    fi
    docker stop xp-capture-proxy >/dev/null 2>&1 || true
    docker rm xp-capture-proxy >/dev/null 2>&1 || true
    echo stopped
    if [ -n "$FILE" ] && [ -f "$BASE/data/$FILE" ]; then
      wc -c "$BASE/data/$FILE"
    else
      echo file=none
    fi
    if netstat -ln 2>/dev/null | grep -q 8898; then
      echo listen=open
    else
      echo listen=closed
    fi
    ;;
  status)
    if docker ps --filter name=xp-capture-proxy --filter status=running -q | grep -q .; then
      echo state=running
      docker ps --filter name=xp-capture-proxy --format '{{.Status}}'
    else
      echo state=stopped
    fi
    if [ -s "$BASE/data/current-session" ]; then
      FILE=$(cat "$BASE/data/current-session")
      echo "file=$FILE"
      if [ -f "$BASE/data/$FILE" ]; then
        wc -c "$BASE/data/$FILE"
      fi
    fi
    netstat -ln 2>/dev/null | grep 8898 || true
    ;;
esac
REMOTE
}

for host in 192.168.0.20 100.113.76.65; do
  if run_remote "$host"; then
    exit 0
  fi
done
echo "capture node unreachable" >&2
exit 1
