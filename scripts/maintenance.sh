#!/bin/bash
# Maintenance Script for GregAI Webservice
# Runs daily at 5:00 AM via Cron

echo "=== System Maintenance: $(date) ==="

# 1. Disk usage check
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
echo "Current Root Disk Usage: ${DISK_USAGE}%"

# 2. Memory check (Render limits are strict 512MB)
MEM_USAGE=$(free -m | awk 'NR==2{printf "%s/%sMB (%.2f%%)", $3,$2,$3*100/$2 }')
echo "Current Memory Usage: ${MEM_USAGE}"

# 3. Aggressive cleanup if disk usage > 80%
if [ "$DISK_USAGE" -gt 80 ]; then
    echo "WARNING: Disk usage high! Triggering aggressive cleanup..."
    # Clear node / npm cache
    npm cache clean --force
    # Clear temp folder
    rm -rf /tmp/*
    # Clear redundant logs, keeping only recent
    find /var/log -type f -name "*.log" -exec truncate -s 0 {} +
    echo "Cleanup complete."
else
    echo "Disk usage acceptable. Proceeding with standard log rotation..."
    # Keep only the last 1MB of app logs if any
    find /app -type f -name "*.log" -exec truncate -s 1M {} +
fi

echo "=== System Maintenance Complete ==="
