#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon (Debian: service cron start, or just cron)
cron 2>/dev/null || service cron start 2>/dev/null || echo "[WARN] Could not start cron"

echo "=============================================="
echo "  GregAI Container Startup Diagnostics"
echo "=============================================="

echo "[DIAG] Java version:"
java -version 2>&1

echo "[DIAG] Signal-CLI:"
which signal-cli 2>&1
signal-cli --version 2>&1 || echo "[DIAG] signal-cli --version failed"

echo "[DIAG] Memory:"
free -m 2>/dev/null || echo "(free not available)"

# Ensure Signal data directory exists
mkdir -p /app/data/signal

echo "[DIAG] Signal account data:"
ls -la /app/data/signal/data/ 2>&1 || echo "  -> No data/ subdirectory!"

if [ -f "/app/data/signal/data/accounts.json" ]; then
    echo "[Signal] Account data found."
else
    echo "[Signal] WARNING: No accounts.json — Signal won't work!"
fi

echo "=============================================="
echo "  Starting Signal-CLI Daemon"
echo "=============================================="

# Pass JVM memory limits directly via -J flags
signal-cli -J-Xmx128m -J-Xms64m \
    --config /app/data/signal \
    -o json \
    --receive-mode manual \
    daemon --tcp 127.0.0.1:8080 \
    > /app/signal-cli.log 2>&1 &
SIGNAL_PID=$!
echo "[Signal] Launched with PID: $SIGNAL_PID"

# Wait for JVM startup
sleep 8

# Check if alive
if kill -0 $SIGNAL_PID 2>/dev/null; then
    echo "[Signal] Daemon is RUNNING (PID: $SIGNAL_PID)"
else
    echo "=============================================="
    echo "[Signal] DAEMON CRASHED! Output:"
    echo "=============================================="
    cat /app/signal-cli.log 2>/dev/null || echo "(empty log)"
    echo "=============================================="
fi

echo "Starting GregAI Node.js Router..."
node src/index.js
