# Debian-based: signal-cli native binary requires glibc (Alpine musl won't work)
FROM node:20-slim

# Install only what we need (NO Java — native image includes everything)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl cron zip unzip dos2unix ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- INSTALL SIGNAL-CLI (Native Image — no Java needed) ----
# Version MUST match what was used for local pairing (database format not backward compatible)
ENV SIGNAL_CLI_VERSION=0.13.22
RUN wget -q https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz \
    && tar xzf signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz -C /opt \
    && rm signal-cli-${SIGNAL_CLI_VERSION}-Linux-native.tar.gz \
    && SIGNAL_BIN=$(find /opt -name "signal-cli" -type f | head -1) \
    && ln -sf "$SIGNAL_BIN" /usr/bin/signal-cli \
    && chmod +x /usr/bin/signal-cli \
    && signal-cli --version

# ---- SETUP APP ----
COPY package*.json ./
RUN npm install --production

COPY src/ ./src/
COPY scripts/ ./scripts/

# Bake in authentication backup (WhatsApp + Signal auth data)
COPY auth_backup.tar.g[z] ./
RUN if [ -f "auth_backup.tar.gz" ]; then tar -xzf auth_backup.tar.gz -C /app/ && rm auth_backup.tar.gz; fi

# Fix line endings and permissions
RUN dos2unix ./scripts/*.sh 2>/dev/null; \
    chmod +x ./scripts/start.sh ./scripts/maintenance.sh

# Setup CRON for Maintenance (Weekly on Sunday)
RUN echo "0 5 * * 0 /app/scripts/maintenance.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/gregai \
    && echo "0 4 * * 0 killall node >> /var/log/cron.log 2>&1" >> /etc/cron.d/gregai \
    && chmod 0644 /etc/cron.d/gregai

ENV NODE_ENV=production
EXPOSE 3000
CMD ["/app/scripts/start.sh"]
