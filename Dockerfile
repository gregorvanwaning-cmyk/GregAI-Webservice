# Use an Alpine base image to save memory
FROM alpine:3.19

# Install Node.js, npm, Java JRE, wget, curl, timezone data, and zip utilities
RUN apk add --no-cache nodejs npm openjdk17-jre-headless bash wget curl tzdata cronie zip unzip

# Set working directory
WORKDIR /app

# ---- INSTALL SIGNAL-CLI ----
ENV SIGNAL_CLI_VERSION=0.12.6
RUN wget https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz \
    && tar xzf signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz -C /opt \
    && ln -s /opt/signal-cli-${SIGNAL_CLI_VERSION}/bin/signal-cli /usr/bin/signal-cli \
    && rm signal-cli-${SIGNAL_CLI_VERSION}-Linux.tar.gz

# ---- SETUP APP ----
# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code and scripts
COPY src/ ./src/
COPY scripts/ ./scripts/

# Bake in authentication backup if it exists (using wildcard to prevent build failure if missing)
COPY auth_backup.zi[p] ./
RUN if [ -f "auth_backup.zip" ]; then unzip -qo auth_backup.zip -d /app/ && rm auth_backup.zip; fi

# Ensure scripts are executable and have linux line endings
RUN apk add --no-cache dos2unix
RUN dos2unix ./scripts/*.sh
RUN chmod +x ./scripts/start.sh
RUN chmod +x ./scripts/maintenance.sh

# Setup CRON for Maintenance (Nightly Restart & Cleanup)
# Runs maintenance.sh at 5:00 AM every day
RUN echo "0 5 * * * /app/scripts/maintenance.sh >> /var/log/cron.log 2>&1" > /etc/crontabs/root
# Restart at 4:00 AM (Handled by Render native restart or just kill index.js so docker restarts it)
RUN echo "0 4 * * * killall node >> /var/log/cron.log 2>&1" >> /etc/crontabs/root

# Set environment
ENV NODE_ENV=production
ENV SIGNAL_CLI_OPTS="-Xmx128m -Xms64m"

# Expose HTTP port for Render
EXPOSE 3000

# Start script
CMD ["/app/scripts/start.sh"]
