const pino = require('pino');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

class WhatsAppClient {
    constructor(routerCallback) {
        this.routerCallback = routerCallback;
        this.sock = null;
        this.msgRetryCounterCache = new NodeCache();
    }

    async start() {
        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            msgRetryCounterCache: this.msgRetryCounterCache,
            browser: ['Ubuntu', 'Chrome', '20.0.04'], // Specifically required browser sig for pairing codes
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

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && !process.env.WHATSAPP_PHONE) {
                console.log('[WhatsApp] Action Required: Scan the QR code below:');
                qrcode.generate(qr, { small: true });
            }

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
