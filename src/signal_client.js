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
            console.warn("[Signal] SIGNAL_PHONE not set. Signal Client won't connect.");
            return;
        }

        console.log(`[Signal] Connecting to JSON-RPC TCP socket at 127.0.0.1:8080`);
        this.client = new net.Socket();

        let buffer = '';

        this.client.connect(8080, '127.0.0.1', () => {
            console.log('[Signal] Connected. Subscribing to incoming messages...');
            this.client.write(JSON.stringify({
                jsonrpc: "2.0",
                method: "receive",
                id: "receive-stream"
            }) + '\n');
        });

        this.client.on('data', async (data) => {
            buffer += data.toString();
            let lines = buffer.split('\n');
            buffer = lines.pop();

            for (let line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);

                    // Incoming message push events from the daemon
                    if (parsed.method === 'receive' && parsed.params && parsed.params.envelope) {
                        const envelope = parsed.params.envelope;
                        if (!envelope.dataMessage || !envelope.dataMessage.message) continue;

                        const messageText = envelope.dataMessage.message;
                        const senderPhone = envelope.source;
                        const groupId = envelope.dataMessage.groupInfo?.groupId || null;

                        // Don't process our own messages
                        if (senderPhone === this.signalPhone) continue;

                        // Route reply to group if message came from a group, otherwise to the sender
                        const replyTo = groupId ? `group:${groupId}` : senderPhone;

                        console.log(`[Signal] Received from ${senderPhone}${groupId ? ' (group:' + groupId.substring(0, 8) + '...)' : ''}: ${messageText}`);

                        if (this.routerCallback) {
                            await this.routerCallback('signal', replyTo, messageText);
                        }
                    }
                    // Responses to our send requests
                    else if (parsed.id && this.pendingRequests.has(parsed.id.toString())) {
                        const req = this.pendingRequests.get(parsed.id.toString());
                        if (parsed.error) {
                            console.error(`[Signal] Send error response:`, parsed.error);
                            req.reject(parsed.error);
                        } else {
                            req.resolve(parsed.result);
                        }
                        this.pendingRequests.delete(parsed.id.toString());
                    }
                } catch (e) {
                    console.error('[Signal] Error parsing JSON-RPC line:', e.message, line.substring(0, 200));
                }
            }
        });

        this.client.on('close', () => {
            console.log('[Signal] TCP disconnected. Reconnecting in 5s...');
            setTimeout(() => this.start(), 5000);
        });

        this.client.on('error', (err) => {
            console.error('[Signal] TCP error:', err.message);
        });
    }

    async sendMessage(recipient, text) {
        return new Promise((resolve, reject) => {
            if (!this.client || this.client.readyState !== 'open') {
                console.error('[Signal] Cannot send — TCP socket not open');
                return reject(new Error('Signal TCP client not open'));
            }

            this.requestId++;
            const id = this.requestId.toString();
            this.pendingRequests.set(id, { resolve, reject });

            let params;
            if (recipient.startsWith('group:')) {
                // Group message: use groupId parameter
                const groupId = recipient.replace('group:', '');
                params = {
                    groupId: groupId,
                    message: text,
                    account: this.signalPhone
                };
                console.log(`[Signal] Sending reply to group ${groupId.substring(0, 8)}...`);
            } else {
                // Direct message: use recipient array
                params = {
                    recipient: [recipient],
                    message: text,
                    account: this.signalPhone
                };
                console.log(`[Signal] Sending reply to ${recipient}`);
            }

            const payload = {
                jsonrpc: "2.0",
                method: "send",
                params: params,
                id: id
            };

            this.client.write(JSON.stringify(payload) + '\n');

            // Timeout after 10s
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    console.error(`[Signal] Timeout waiting for send response (id: ${id})`);
                    reject(new Error('Timeout waiting for signal-cli response'));
                }
            }, 10000);
        });
    }
}

module.exports = SignalClient;
