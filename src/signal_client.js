const WebSocket = require('ws');
const axios = require('axios');

class SignalClient {
    constructor(routerCallback) {
        this.signalUrl = process.env.SIGNAL_URL || 'http://127.0.0.1:8080';
        this.signalPhone = process.env.SIGNAL_PHONE || '+31649649017';
        this.routerCallback = routerCallback;
        this.ws = null;
    }

    start() {
        if (!this.signalPhone) {
            console.warn("SIGNAL_PHONE not set. Signal Client won't connect.");
            return;
        }

        const wsUrl = this.signalUrl.replace('http', 'ws') + '/v1/receive/' + this.signalPhone;
        console.log(`[Signal] Connecting to WS: ${wsUrl}`);

        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log('[Signal] Connected to WebSocket securely.');
        });

        this.ws.on('message', async (data) => {
            try {
                const parsed = JSON.parse(data);
                // The structure usually has envelope.dataMessage
                if (!parsed.envelope || !parsed.envelope.dataMessage || !parsed.envelope.dataMessage.message) {
                    return;
                }

                const messageText = parsed.envelope.dataMessage.message;
                const sender = parsed.envelope.source;

                // Do not parse messages sent from ourselves unless necessary
                if (sender === this.signalPhone) return;

                console.log(`[Signal] Received from ${sender}: ${messageText}`);

                // Forward to router
                if (this.routerCallback) {
                    await this.routerCallback('signal', sender, messageText);
                }

            } catch (e) {
                console.error('[Signal] Error parsing incoming message:', e);
            }
        });

        this.ws.on('close', () => {
            console.log('[Signal] WS disconnected. Reconnecting in 5s...');
            setTimeout(() => this.start(), 5000);
        });

        this.ws.on('error', (err) => {
            console.error('[Signal] WS error:', err.message);
            this.ws.close();
        });
    }

    async sendMessage(recipient, text) {
        try {
            const url = `${this.signalUrl}/v2/send`;
            const payload = {
                message: text,
                number: this.signalPhone,
                recipients: [recipient],
                text_mode: "normal"
            };
            await axios.post(url, payload);
            console.log(`[Signal] Sent message to ${recipient}`);
        } catch (error) {
            console.error('[Signal] Failed to send message:', error.message);
        }
    }
}

module.exports = SignalClient;
