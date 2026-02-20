const net = require('net');

class SignalClient {
    constructor(routerCallback) {
        this.signalPhone = process.env.SIGNAL_PHONE || '+31649649017';
        this.routerCallback = routerCallback;
        this.client = null;
        this.requestId = 0;
        this.pendingRequests = new Map();
    }

    start() {
        if (!this.signalPhone) {
            console.warn("SIGNAL_PHONE not set. Signal Client won't connect.");
            return;
        }

        console.log(`[Signal] Connecting to raw JSON-RPC TCP socket at 127.0.0.1:8080`);
        this.client = new net.Socket();

        let buffer = '';

        this.client.connect(8080, '127.0.0.1', () => {
            console.log('[Signal] Connected to TCP socket securely.');
        });

        this.client.on('data', async (data) => {
            buffer += data.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop(); // keep remainder

            for (let line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);

                    // Unsolicited Push Events from daemon (receive)
                    if (parsed.method === 'receive' && parsed.params && parsed.params.envelope) {
                        const envelope = parsed.params.envelope;
                        if (!envelope.dataMessage || !envelope.dataMessage.message) continue;

                        const messageText = envelope.dataMessage.message;
                        const sender = envelope.source;

                        // Do not parse messages sent from ourselves
                        if (sender === this.signalPhone) continue;

                        console.log(`[Signal] Received from ${sender}: ${messageText}`);

                        // Forward to router
                        if (this.routerCallback) {
                            await this.routerCallback('signal', sender, messageText);
                        }
                    }
                    // Responses to our JSON-RPC requests (e.g., send)
                    else if (parsed.id && this.pendingRequests.has(parsed.id.toString())) {
                        const req = this.pendingRequests.get(parsed.id.toString());
                        if (parsed.error) {
                            req.reject(parsed.error);
                        } else {
                            req.resolve(parsed.result);
                        }
                        this.pendingRequests.delete(parsed.id.toString());
                    }
                } catch (e) {
                    console.error('[Signal] Error parsing JSON-RPC line:', e, line);
                }
            }
        });

        this.client.on('close', () => {
            console.log('[Signal] TCP disconnected. Reconnecting in 5s...');
            setTimeout(() => this.start(), 5000);
        });

        this.client.on('error', (err) => {
            console.error('[Signal] TCP error:', err.message);
            // close will be fired
        });
    }

    async sendMessage(recipient, text) {
        return new Promise((resolve, reject) => {
            if (!this.client || this.client.readyState !== 'open') {
                return reject(new Error('Signal TCP client not open'));
            }

            this.requestId++;
            const id = this.requestId.toString();

            this.pendingRequests.set(id, { resolve, reject });

            const payload = {
                jsonrpc: "2.0",
                method: "send",
                params: {
                    recipient: [recipient],
                    message: text
                },
                id: id
            };

            this.client.write(JSON.stringify(payload) + '\n');
            console.log(`[Signal] Sending message to ${recipient}`);

            // cleanup if no response in 10s
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Timeout waiting for signal-cli response'));
                }
            }, 10000);
        });
    }
}

module.exports = SignalClient;
