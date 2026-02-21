require('dotenv').config();
const express = require('express');
const WhatsAppClient = require('./whatsapp_client');
const SignalClient = require('./signal_client');
const CommandParser = require('./command_parser');

const app = express();
const PORT = process.env.PORT || 3000;

let whatsapp, signal;
const BOOT_TIME = Date.now();

async function restartServices() {
    console.log("[SYSTEM] Restarting services...");
    process.exit(1);
}

// Global Callback Router
const routerCallback = async (platform, sender, messageText) => {
    try {
        const response = await CommandParser.processMessage(platform, sender, messageText);
        console.log(`[Router] Parser returned response:`, !!response ? 'YES' : 'NO');

        let replyTarget = sender;
        if (platform === 'whatsapp' && sender.includes('::')) {
            replyTarget = sender.split('::')[0];
        }

        if (!response) {
            console.log(`[Router] Ignoring message: Sleep mode active or no action required.`);
            return;
        }

        if (response.action === 'RESTART') {
            const msg = "Restarting GregAI services...";
            if (platform === 'whatsapp') {
                await whatsapp.sendMessage(replyTarget, msg);
            } else if (platform === 'signal') {
                await signal.sendMessage(sender, msg);
            }
            setTimeout(restartServices, 3000);
            return;
        }

        if (platform === 'whatsapp') {
            await whatsapp.sendMessage(replyTarget, response);
            console.log(`[Router] Successfully dispatched WhatsApp reply to ${replyTarget}`);
        } else if (platform === 'signal') {
            await signal.sendMessage(sender, response);
            console.log(`[Router] Successfully dispatched Signal reply to ${sender}`);
        }

    } catch (e) {
        console.error(`[Router] Error handling message from ${platform}:`, e);
    }
};

async function bootstrap() {
    console.log("=== Starting GregAI Webservice ===");

    whatsapp = new WhatsAppClient(routerCallback);
    signal = new SignalClient(routerCallback);

    await whatsapp.start();
    signal.start();

    // --- HTTP Server ---
    app.get('/', (req, res) => {
        res.send("GregAI Webservice is running.");
    });

    app.get('/health', (req, res) => {
        const waHealthy = whatsapp?.isHealthy() || false;
        const waReconnecting = whatsapp?.isReconnecting || false;
        const sigConnected = signal?.client?.readyState === 'open';

        res.json({
            status: 'running',
            uptime: Math.round(process.uptime()),
            whatsapp: waHealthy ? 'healthy' : (waReconnecting ? 'reconnecting' : 'inactive'),
            whatsappLastActivity: whatsapp?.lastActivityAt ? new Date(whatsapp.lastActivityAt).toISOString() : 'never',
            signal: sigConnected ? 'connected' : 'disconnected',
            memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            timestamp: new Date().toISOString()
        });
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Router] HTTP Server listening on port ${PORT}`);
    });

    // ===================================================================
    //  CONNECTION MONITOR — runs every 2 minutes
    //  IMPORTANT: This does NOT tear down the socket. It only logs status.
    //  Baileys handles its own reconnection via the connection.update event.
    //  We only intervene if the connection has been dead for a LONG time.
    // ===================================================================
    let consecutiveDeadChecks = 0;

    setInterval(() => {
        const healthy = whatsapp?.isHealthy() || false;
        const reconnecting = whatsapp?.isReconnecting || false;

        if (healthy) {
            consecutiveDeadChecks = 0;
            const lastAct = whatsapp?.lastActivityAt ? new Date(whatsapp.lastActivityAt).toISOString() : 'never';
            console.log(`[Monitor] WhatsApp OK. Last activity: ${lastAct}. Uptime: ${Math.round(process.uptime())}s`);
            return;
        }

        if (reconnecting) {
            console.log(`[Monitor] WhatsApp reconnecting (attempt #${whatsapp.reconnectAttempts}). Standing by.`);
            return;
        }

        // No activity in the last 5 minutes AND not actively reconnecting
        consecutiveDeadChecks++;
        const lastAct = whatsapp?.lastActivityAt ? new Date(whatsapp.lastActivityAt).toISOString() : 'never';
        console.warn(`[Monitor] WhatsApp inactive (check #${consecutiveDeadChecks}). Last activity: ${lastAct}`);

        // After 5 consecutive inactive checks (10 minutes), trigger a reconnect
        if (consecutiveDeadChecks >= 5) {
            console.error(`[Monitor] WhatsApp inactive for ${consecutiveDeadChecks * 2} minutes. Forcing reconnect.`);
            consecutiveDeadChecks = 0;
            if (whatsapp) whatsapp.reconnect('monitor_inactive_10min');
        }
    }, 2 * 60 * 1000);

    // ===================================================================
    //  SELF-HEALING WATCHDOG — runs every 5 minutes
    //  If WhatsApp has never successfully connected in 10 minutes,
    //  or has been disconnected for 10+ minutes, restart the process.
    //  This is the ultimate safety net.
    // ===================================================================
    setInterval(() => {
        const now = Date.now();
        const uptimeMs = now - BOOT_TIME;

        // Don't check during initial boot (give it 3 minutes to settle)
        if (uptimeMs < 3 * 60 * 1000) return;

        const lastActivity = whatsapp?.lastActivityAt || 0;
        const inactiveMs = now - lastActivity;

        // If never had any activity after 5 minutes of uptime, restart
        if (lastActivity === 0 && uptimeMs > 5 * 60 * 1000) {
            console.error(`[Watchdog] WhatsApp NEVER connected after ${Math.round(uptimeMs / 1000)}s uptime. Restarting process!`);
            process.exit(1);
        }

        // If no activity for more than 15 minutes, restart
        if (lastActivity > 0 && inactiveMs > 15 * 60 * 1000) {
            console.error(`[Watchdog] WhatsApp inactive for ${Math.round(inactiveMs / 60000)} minutes. Restarting process!`);
            process.exit(1);
        }
    }, 5 * 60 * 1000);
}

// ===================================================================
//  GLOBAL ERROR HANDLERS
//  Catch Baileys internal errors that bubble up as uncaughtExceptions.
//  Instead of crashing, we reconnect gracefully.
// ===================================================================
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.message);
    console.error(err.stack);

    // Check if error originates from Baileys
    const isBaileysError = err.stack && (
        err.stack.includes('@whiskeysockets/baileys') ||
        err.stack.includes('noise-handler') ||
        err.stack.includes('aesDecryptGCM')
    );

    if (isBaileysError) {
        console.warn('[FATAL] Baileys internal error detected. Triggering WhatsApp reconnect...');
        if (whatsapp) {
            whatsapp.isReconnecting = false; // Force unlock
            whatsapp.reconnect('uncaught_baileys_error');
        } else {
            process.exit(1);
        }
    } else {
        // Unknown fatal error — let Render restart the container
        console.error('[FATAL] Non-Baileys error. Exiting for container restart.');
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection:', reason);
});

bootstrap().catch((err) => {
    console.error('[BOOT] Fatal bootstrap error:', err);
    process.exit(1);
});
