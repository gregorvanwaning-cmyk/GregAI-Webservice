# Debian-based image: glibc native (signal-cli native libs require glibc, Alpine musl won't work)
FROM node:20-slim

# Install Java 21, signal-cli dependencies, and utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-21-jre-headless \
    wget curl cron zip unzip dos2unix ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# ---- INSTALL SIGNAL-CLI ----
# Version MUST match what was used for local pairing (database format not backward compatible)
ENV SIGNAL_CLI_VERSION=0.13.22
RUN wget -q https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz \
    && tar xzf signal-cli-${SIGNAL_CLI_VERSION}.tar.gz -C /opt \
    && ln -s /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/bin/signal-cli \
    && rm signal-cli-${SIGNAL_CLI_VERSION}.tar.gz

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

# Setup CRON for Maintenance
RUN echo "0 5 * * * /app/scripts/maintenance.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/gregai \
    && echo "0 4 * * * killall node >> /var/log/cron.log 2>&1" >> /etc/cron.d/gregai \
    && chmod 0644 /etc/cron.d/gregai

# Set environment
ENV NODE_ENV=production

# Expose HTTP port for Render
EXPOSE 3000

# Start script
CMD ["/app/scripts/start.sh"]
