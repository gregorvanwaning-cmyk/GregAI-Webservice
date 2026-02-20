#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon for maintenance scripts
crond -b

echo "Checking for persistent authentication backups..."
if [ -n "$AUTH_BACKUP_URL" ]; then
    echo "Downloading authentication data from AUTH_BACKUP_URL..."
    curl -sL "$AUTH_BACKUP_URL" -o /tmp/auth_backup.zip
    if [ -f "/tmp/auth_backup.zip" ]; then
        echo "Extracting authentication data..."
        unzip -qo /tmp/auth_backup.zip -d /app/
        rm /tmp/auth_backup.zip
    fi
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
