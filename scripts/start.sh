#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon (Alpine 3.21 uses -b for background, fall back if unsupported)
crond -b 2>/dev/null || crond -f &

echo "=============================================="
echo "  GregAI Container Startup"
echo "=============================================="

echo "[DIAG] Java version:"
java -version 2>&1

echo "[DIAG] Signal-CLI location:"
which signal-cli 2>&1

echo "[DIAG] Free memory:"
free -m 2>/dev/null || cat /proc/meminfo 2>/dev/null | head -3

# Ensure Signal data directory exists
mkdir -p /app/data/signal

echo "[DIAG] Signal account data:"
ls -la /app/data/signal/data/ 2>&1 || echo "  -> No data/ subdirectory found!"

if [ -f "/app/data/signal/data/accounts.json" ]; then
    echo "[Signal] Account data found."
else
    echo "[Signal] WARNING: No accounts.json — daemon will fail!"
fi

echo "=============================================="
echo "  Starting Signal-CLI Daemon"
echo "=============================================="

# Pass JVM memory limits DIRECTLY via -J flags (env var SIGNAL_CLI_OPTS may not work in 0.13.x)
signal-cli -J-Xmx128m -J-Xms64m \
    --config /app/data/signal \
    -o json \
    --receive-mode manual \
    daemon --tcp 127.0.0.1:8080 \
    > /app/signal-cli.log 2>&1 &
SIGNAL_PID=$!
echo "[Signal] Launched daemon PID: $SIGNAL_PID"

# Wait for JVM startup
sleep 8

# Check if alive
if kill -0 $SIGNAL_PID 2>/dev/null; then
    echo "[Signal] Daemon is RUNNING"
else
    echo "=============================================="
    echo "[Signal] DAEMON CRASHED! Full output:"
    echo "=============================================="
    cat /app/signal-cli.log 2>/dev/null || echo "(no log)"
    echo "=============================================="
fi

echo "Starting GregAI Node.js Router..."
node src/index.js
