const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const NodeCache = require('node-cache');

class WhatsAppClient {
    constructor(routerCallback) {
        this.routerCallback = routerCallback;
        this.sock = null;
        this.msgRetryCounterCache = new NodeCache();
    }

    async start() {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'silent' }),
            msgRetryCounterCache: this.msgRetryCounterCache,
            browser: ['GregAI', 'MacOS', '1.0'],
            syncFullHistory: false
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[WhatsApp] Connection closed. Reconnecting: ${shouldReconnect}`);
                if (shouldReconnect) {
                    this.start();
                } else {
                    console.log('[WhatsApp] Logged out. Delete auth_info_baileys and restart to scan QR.');
                }
            } else if (connection === 'open') {
                console.log('[WhatsApp] Connected securely.');
            }
        });

        this.sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            const msg = m.messages[0];

            // Ignore status messages and group messages (optional, here we only check self)
            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;

            // Extract text body
            const messageType = Object.keys(msg.message)[0];
            let text = '';

            if (messageType === 'conversation') {
                text = msg.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                text = msg.message.extendedTextMessage.text;
            } else {
                return; // Not a text message
            }

            console.log(`[WhatsApp] Received from ${sender}: ${text}`);

            if (this.routerCallback) {
                await this.routerCallback('whatsapp', sender, text);
            }
        });
    }

    async sendMessage(recipientJid, text) {
        if (!this.sock) {
            console.error('[WhatsApp] Socket not initialized.');
            return;
        }

        try {
            await this.sock.sendMessage(recipientJid, { text: text });
            console.log(`[WhatsApp] Sent message to ${recipientJid}`);
        } catch (error) {
            console.error('[WhatsApp] Send error:', error);
        }
    }
}

module.exports = WhatsAppClient;
