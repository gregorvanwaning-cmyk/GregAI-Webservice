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
        this.processedMessages = []; // Track recently processed msg IDs to prevent duplicates
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

    async reconnect() {
        console.log('[WhatsApp] Forcefully disconnecting and rebuilding socket...');
        if (this.sock) {
            try {
                this.sock.ws.close();
            } catch (e) {
                // Ignore errors closing a dead socket
            }
        }
        setTimeout(() => this._createSocket(), 2000);
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

            // ---- Deduplication Check ----
            const msgId = msg.key.id;
            if (this.processedMessages.includes(msgId)) {
                return; // Already processed this message
            }
            this.processedMessages.push(msgId);
            if (this.processedMessages.length > 100) {
                this.processedMessages.shift(); // Keep only the last 100 IDs
            }
            // -----------------------------

            const remoteJid = msg.key.remoteJid;
            // The actual sender phone is in participant for groups/LID, otherwise it's just the remoteJid
            const senderPhone = msg.participant || msg.key.remoteJid;

            const messageType = Object.keys(msg.message)[0];
            let text = '';

            if (messageType === 'conversation') {
                text = msg.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                text = msg.message.extendedTextMessage.text;
            } else {
                return;
            }

            console.log(`[WhatsApp] Received from ${senderPhone} (JID: ${remoteJid}): ${text}`);

            if (this.routerCallback) {
                // We pass BOTH the reply target (remoteJid) and the actual identity (senderPhone)
                // We format sender to "remoteJid::senderPhone" so the router can reply to the right place
                // but still check the real phone number for admin rights.
                const senderIdentity = `${remoteJid}::${senderPhone}`;
                await this.routerCallback('whatsapp', senderIdentity, text);
            }
        });
    }

    async sendMessage(recipientJid, text) {
        if (!this.sock) {
            console.error('[WhatsApp] Socket not initialized.');
            return;
        }

        // Do NOT normalize @lid JIDs — Baileys routes them correctly internally.
        // Converting @lid to @s.whatsapp.net sends replies to the WRONG person.
        console.log(`[WhatsApp] Sending reply to: ${recipientJid}`);

        try {
            const sendPromise = this.sock.sendMessage(recipientJid, { text: text });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('TIMEOUT: WhatsApp send not acknowledged within 10s')), 10000);
            });

            await Promise.race([sendPromise, timeoutPromise]);
            console.log(`[WhatsApp] Message delivered to ${recipientJid}`);
        } catch (error) {
            console.error(`[WhatsApp] Send error to ${recipientJid}:`, error.message || error);
        }
    }
}

module.exports = WhatsAppClient;
