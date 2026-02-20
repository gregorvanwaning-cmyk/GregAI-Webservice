#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon for maintenance scripts
crond -b

echo "Starting Signal-CLI daemon (TCP mode, limited to 128MB)..."
mkdir -p /app/data/signal

# Check if signal account data exists
if [ -d "/app/data/signal/data" ]; then
    echo "[Signal] Found existing account data."
else
    echo "[Signal] WARNING: No account data found in /app/data/signal/ — daemon will likely fail."
    echo "[Signal] You need to pair Signal and bake auth into auth_backup.tar.gz"
fi

# Start signal-cli daemon with memory limits and stderr capture
export SIGNAL_CLI_OPTS="${SIGNAL_CLI_OPTS:--Xmx128m -Xms64m}"
signal-cli --config /app/data/signal -o json --receive-mode manual daemon --tcp 127.0.0.1:8080 2>&1 | tee /app/signal-cli.log &
SIGNAL_PID=$!

# Wait for JVM to initialize
sleep 5

# Verify signal-cli is actually running
if kill -0 $SIGNAL_PID 2>/dev/null; then
    echo "[Signal] Daemon started successfully (PID: $SIGNAL_PID)"
else
    echo "[Signal] ERROR: Daemon failed to start! Check /app/signal-cli.log"
    cat /app/signal-cli.log 2>/dev/null || echo "(no log file)"
fi

echo "Starting GregAI Node.js Router..."
node src/index.js
