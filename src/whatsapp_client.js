const pino = require('pino');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

class WhatsAppClient {
    constructor(routerCallback) {
        this.routerCallback = routerCallback;
        this.sock = null;
        this.msgRetryCounterCache = new NodeCache();
        this._baileys = null; // Cache the ESM import
    }

    /**
     * Create (or recreate) the Baileys socket and bind its events.
     * On reconnect we call _createSocket() instead of start() to avoid
     * stacking duplicate event listeners.
     */
    async start() {
        this._baileys = await import('@whiskeysockets/baileys');
        await this._createSocket();
    }

    async _createSocket() {
        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = this._baileys;
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            msgRetryCounterCache: this.msgRetryCounterCache,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            syncFullHistory: false
        });

        if (!this.sock.authState.creds.registered) {
            const phoneNumber = process.env.WHATSAPP_PHONE?.replace(/[^0-9]/g, '');
            if (phoneNumber) {
                setTimeout(async () => {
                    try {
                        let code = await this.sock.requestPairingCode(phoneNumber);
                        code = code?.match(/.{1,4}/g)?.join('-');
                        fs.writeFileSync('pairing_code.txt', code || 'FAILED');
                        console.log(`\n======================================================`);
                        console.log(`[WhatsApp] PAIRING CODE: ${code}`);
                        console.log(`[WhatsApp] Go to WhatsApp -> Linked Devices -> Link with Phone Number`);
                        console.log(`======================================================\n`);
                    } catch (e) {
                        console.error('[WhatsApp] Failed to request pairing code:', e);
                    }
                }, 3000);
            }
        }

        // --- Bind events fresh for THIS socket instance ---
        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && !process.env.WHATSAPP_PHONE) {
                console.log('[WhatsApp] Action Required: Scan the QR code below:');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[WhatsApp] Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
                if (shouldReconnect) {
                    // Reconnect by creating a NEW socket — NOT calling start() again
                    setTimeout(() => this._createSocket(), 2000);
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

            if (!msg.message || msg.key.fromMe) return;

            const sender = msg.key.remoteJid;

            const messageType = Object.keys(msg.message)[0];
            let text = '';

            if (messageType === 'conversation') {
                text = msg.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                text = msg.message.extendedTextMessage.text;
            } else {
                return;
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

        const normalizedJid = recipientJid.split(':')[0].replace(/@.*$/, '') + '@s.whatsapp.net';

        try {
            const sendPromise = this.sock.sendMessage(normalizedJid, { text: text });

            // Defend against silent Baileys Promise hangs by wrapping in a 5-second timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('TIMEOUT: WhatsApp server did not acknowledge message dispatch within 5 seconds')), 5000);
            });

            await Promise.race([sendPromise, timeoutPromise]);
            console.log(`[WhatsApp] Successfully returned HTTP ACK for sent message to ${normalizedJid}`);
        } catch (error) {
            console.error(`[WhatsApp] Send error to ${normalizedJid}:`, error.message || error);
        }
    }
}

module.exports = WhatsAppClient;
