const pino = require('pino');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

class WhatsAppClient {
    constructor(routerCallback) {
        this.routerCallback = routerCallback;
        this.sock = null;
        this.msgRetryCounterCache = new NodeCache();
        this._baileys = null;
        this.processedMessages = [];
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.lastConnectedAt = 0;    // Timestamp of last successful connection
        this.lastMessageAt = 0;      // Timestamp of last message received/sent
        this._reconnectTimer = null;  // Prevent overlapping timers
    }

    async start() {
        this._baileys = await import('@whiskeysockets/baileys');
        await this._createSocket();
    }

    /**
     * Exponential backoff with jitter: 5s, 10s, 20s, 40s, capped at 60s + random jitter
     */
    _nextDelay() {
        const base = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
        const jitter = Math.floor(Math.random() * (base / 2));
        this.reconnectAttempts++;
        return base + jitter;
    }

    /**
     * SINGLE entry point for all reconnection. All paths go through here.
     * Prevents duplicate socket creation via isReconnecting lock and timer guard.
     */
    reconnect(reason = 'unknown') {
        if (this.isReconnecting) {
            console.log(`[WhatsApp] Reconnect already in progress (reason: ${reason}), skipping.`);
            return;
        }
        this.isReconnecting = true;

        // Clear any pending reconnect timer
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        // Clean up old socket completely
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners('creds.update');
                this.sock.ev.removeAllListeners('connection.update');
                this.sock.ev.removeAllListeners('messages.upsert');
                if (this.sock.ws) this.sock.ws.close();
            } catch (e) {
                // Ignore errors closing a dead socket
            }
            this.sock = null;
        }

        const delay = this._nextDelay();
        console.log(`[WhatsApp] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${this.reconnectAttempts}, reason: ${reason})`);

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._createSocket();
        }, delay);
    }

    async _createSocket() {
        try {
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
                        // Let reconnect() handle lock, cleanup, and backoff
                        this.isReconnecting = false; // Unlock so reconnect() can proceed
                        this.reconnect(`close_code_${statusCode}`);
                    } else {
                        console.log('[WhatsApp] Logged out. Delete auth_info_baileys and restart to scan QR.');
                        this.isReconnecting = false;
                    }
                } else if (connection === 'open') {
                    console.log('[WhatsApp] Connected securely.');
                    this.reconnectAttempts = 0;
                    this.lastConnectedAt = Date.now();
                    this.isReconnecting = false;
                }
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                if (m.type !== 'notify') return;
                const msg = m.messages[0];

                if (!msg.message || msg.key.fromMe) return;

                // ---- Deduplication Check ----
                const msgId = msg.key.id;
                if (this.processedMessages.includes(msgId)) {
                    return;
                }
                this.processedMessages.push(msgId);
                if (this.processedMessages.length > 100) {
                    this.processedMessages.shift();
                }

                this.lastMessageAt = Date.now();

                const remoteJid = msg.key.remoteJid;
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
                    const senderIdentity = `${remoteJid}::${senderPhone}`;
                    await this.routerCallback('whatsapp', senderIdentity, text);
                }
            });

        } catch (e) {
            console.error('[WhatsApp] _createSocket fatal error:', e.message);
            this.isReconnecting = false;
            // Schedule retry after a delay
            const delay = this._nextDelay();
            console.log(`[WhatsApp] Will retry _createSocket in ${(delay / 1000).toFixed(1)}s`);
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this._createSocket();
            }, delay);
        }
    }

    /**
     * Returns true if the WhatsApp WebSocket is currently in an OPEN state.
     */
    isConnected() {
        try {
            return this.sock && this.sock.ws && this.sock.ws.readyState === 1;
        } catch {
            return false;
        }
    }

    async sendMessage(recipientJid, text) {
        if (!this.sock) {
            console.error('[WhatsApp] Socket not initialized.');
            return;
        }

        console.log(`[WhatsApp] Sending reply to: ${recipientJid}`);

        try {
            const sendPromise = this.sock.sendMessage(recipientJid, { text: text });
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('TIMEOUT: WhatsApp send not acknowledged within 10s')), 10000);
            });

            await Promise.race([sendPromise, timeoutPromise]);
            this.lastMessageAt = Date.now();
            console.log(`[WhatsApp] Message delivered to ${recipientJid}`);
        } catch (error) {
            console.error(`[WhatsApp] Send error to ${recipientJid}:`, error.message || error);
        }
    }
}

module.exports = WhatsAppClient;
