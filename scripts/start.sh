#!/bin/bash
# Start script for GregAI WebService Docker Container

# Start Cron daemon for maintenance scripts
crond -b

echo "Starting Signal-CLI REST API (Daemon mode) limited to 128MB..."
# We map the persistent volume to `/app/signal_data` in render.yaml
mkdir -p /app/data/signal

# We only need one instance: the JSON-RPC daemon over TCP
# We need to start the signal-cli json-rpc natively over a tcp port:
# Let's use signal-cli json-rpc natively over a tcp port:
signal-cli --config /app/data/signal -o json --receive-mode manual daemon --tcp 127.0.0.1:8080 &

# Wait a moment for Java JVM to initialize
sleep 5

echo "Starting GregAI Node.js Router..."
node src/index.js
