#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon for maintenance scripts
crond -b

echo "Checking for persistent authentication backups..."
if [ -f "/etc/secrets/auth_backup.zip" ]; then
    echo "Restoring authentication data from Secret File..."
    unzip -qo /etc/secrets/auth_backup.zip -d /app/
fi

echo "Starting Signal-CLI REST API (Daemon mode) limited to 128MB..."
# We map the persistent volume to `/app/signal_data` in render.yaml
mkdir -p /app/data/signal
signal-cli --config /app/data/signal daemon --socket /tmp/signal-cli.socket &

# Start a small wrapper/proxy if needed or rely on OpenClaw's direct WS.
# Actually signal-cli daemon provides DBus by default. To use JSON-RPC over TCP/REST:
# We need to start the signal-cli json-rpc or use signal-cli-rest-api.
# Let's use signal-cli json-rpc natively over a tcp port:
signal-cli --config /app/data/signal -o json --receive-mode manual daemon --tcp 127.0.0.1:8080 &

# Wait a moment for Java JVM to initialize
sleep 5

echo "Starting GregAI Node.js Router..."
node src/index.js
