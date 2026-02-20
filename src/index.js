require('dotenv').config();
const express = require('express');
const WhatsAppClient = require('./whatsapp_client');
const SignalClient = require('./signal_client');
const CommandParser = require('./command_parser');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

let whatsapp, signal;

async function restartServices() {
    console.log("[SYSTEM] Restarting services...");
    // If run using pm2 or Docker with restart-on-fail, exiting will trigger restart.
    process.exit(1);
}

// Global Callback Router
const routerCallback = async (platform, sender, messageText) => {
    try {
        const response = await CommandParser.processMessage(platform, sender, messageText);
        console.log(`[Router] Parser returned response:`, !!response ? 'YES' : 'NO');

        // Extract explicit reply target (WhatsApp uses remoteJid::participant format)
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
            // Signal-cli over TCP needs a bit more time to flush the send before we kill the process
            setTimeout(restartServices, 3000);
            return;
        }

        // Send back response natively
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

    // Initialize Clients
    whatsapp = new WhatsAppClient(routerCallback);
    signal = new SignalClient(routerCallback);

    await whatsapp.start();
    signal.start();

    // Start HTTP Server for Render Health Checks
    app.get('/', (req, res) => {
        res.send("GregAI Webservice is running.");
    });

    app.get('/health', (req, res) => {
        res.json({ status: "healthy", timestamp: Date.now() });
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Router] HTTP Server listening on port ${PORT}`);
    });

    // --- Connection Monitor (Silent Drop Protection) ---
    // Baileys sometimes silently drops the connection without emitting a 'close' event.
    // We check health every 2 minutes. If it's dead, we restart the whole container.
    setInterval(async () => {
        try {
            if (whatsapp && whatsapp.sock && whatsapp.sock.ws) {
                // To strictly verify a WebSocket is alive, we must ping and wait for a pong.
                // sendPresenceUpdate resolves instantly (it just queues locally), so it was bypassing the timeout.
                await new Promise((resolve, reject) => {
                    const ws = whatsapp.sock.ws;

                    // If ws is somehow already in a closed state
                    if (ws.readyState !== 1) return reject(new Error('WS_NOT_OPEN'));

                    let timeout = setTimeout(() => reject(new Error('TIMEOUT')), 10000);

                    ws.once('pong', () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    ws.ping();
                });
            }
        } catch (e) {
            console.error(`[Monitor] WhatsApp connection appears DEAD! Rebuilding socket...`, e.message);
            if (whatsapp) whatsapp.reconnect();
        }
    }, 2 * 60 * 1000);
}

// Global Error Handlers to prevent Baileys crypto errors from crashing Node
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    if (err.message && err.message.includes('Unsupported state or unable to authenticate data')) {
        console.warn('[FATAL] Baileys crypto crash detected. Reconnecting WhatsApp...');
        if (whatsapp) {
            whatsapp.reconnect();
        } else {
            process.exit(1);
        }
    } else {
        // Exit for other unknown fatal errors so Render can restart the container
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

bootstrap().catch(console.error);
