#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon for maintenance scripts
crond -b

echo "=============================================="
echo "  GregAI Container Startup Diagnostics"
echo "=============================================="

# Pre-flight checks
echo "[DIAG] Java version:"
java -version 2>&1 || echo "[DIAG] ERROR: Java not found!"

echo "[DIAG] Signal-CLI binary:"
which signal-cli && signal-cli --version 2>&1 || echo "[DIAG] ERROR: signal-cli not found!"

echo "[DIAG] Memory status:"
free -m 2>/dev/null || cat /proc/meminfo 2>/dev/null | head -5

# Check signal account data
mkdir -p /app/data/signal
echo "[DIAG] Signal data directory contents:"
ls -la /app/data/signal/ 2>&1
ls -la /app/data/signal/data/ 2>&1 || echo "[DIAG] No /app/data/signal/data/ directory!"

if [ -f "/app/data/signal/data/accounts.json" ]; then
    echo "[Signal] Found accounts.json - account data exists."
    cat /app/data/signal/data/accounts.json 2>/dev/null
else
    echo "[Signal] ERROR: No accounts.json found! Signal was never paired in this image."
fi

echo "=============================================="
echo "  Starting Signal-CLI Daemon"
echo "=============================================="

# Start signal-cli daemon — write output directly to log file AND stdout
export SIGNAL_CLI_OPTS="${SIGNAL_CLI_OPTS:--Xmx128m -Xms64m}"
signal-cli --config /app/data/signal -o json --receive-mode manual daemon --tcp 127.0.0.1:8080 > /app/signal-cli.log 2>&1 &
SIGNAL_PID=$!
echo "[Signal] Daemon launched with PID: $SIGNAL_PID"

# Wait for JVM to initialize (Java 21 is heavier)
sleep 8

# Check if still alive
if kill -0 $SIGNAL_PID 2>/dev/null; then
    echo "[Signal] Daemon is RUNNING (PID: $SIGNAL_PID)"
else
    echo "=============================================="
    echo "[Signal] DAEMON CRASHED! Exit log below:"
    echo "=============================================="
    cat /app/signal-cli.log 2>/dev/null || echo "(no log captured)"
    echo "=============================================="
fi

echo "Starting GregAI Node.js Router..."
node src/index.js
