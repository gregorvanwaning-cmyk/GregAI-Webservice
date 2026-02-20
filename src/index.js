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
            if (whatsapp && whatsapp.sock) {
                // Presence update is a lightweight API call to verify the socket is alive
                // Wrap in timeout because a dead socket might hang indefinitely
                await Promise.race([
                    whatsapp.sock.sendPresenceUpdate('available'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10000))
                ]);
            }
        } catch (e) {
            console.error(`[Monitor] WhatsApp connection appears DEAD! Triggering restart...`, e.message);
            restartServices();
        }
    }, 2 * 60 * 1000);
}

bootstrap().catch(console.error);
