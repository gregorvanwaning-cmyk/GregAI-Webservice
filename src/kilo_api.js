const axios = require('axios');

class KiloAPI {
    constructor() {
        this.apiKey = process.env.KILO_API_KEY;
        this.baseUrl = 'https://api.kilo.ai/api/gateway';
        if (!this.apiKey) {
            console.warn('[KiloAPI] WARNING: KILO_API_KEY environment variable is not set!');
        }
    }

    async getTopFreeModels() {
        try {
            const response = await axios.get(`${this.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            // Filter to only free models (those with ':free' suffix or 'kilo/auto')
            let models = response.data.data
                .map(m => m.id)
                .filter(id => id.includes(':free') || id === 'kilo/auto');
            return models.slice(0, 10);
        } catch (error) {
            console.error('[KiloAPI] Error fetching models:', error?.response?.data || error.message);
            return ["kilo/auto", "minimax/minimax-m2.5:free", "z-ai/glm-5:free"];
        }
    }

    async queryLLM(modelName, messageText, systemPrompt) {
        try {
            const requestBody = {
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: messageText }
                ],
                max_tokens: 1000
            };

            const startTime = Date.now();
            const response = await axios.post(`${this.baseUrl}/chat/completions`, requestBody, {
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
            });
            const durationSec = Math.round((Date.now() - startTime) / 1000);

            const resultText = response.data.choices[0].message.content;
            return { text: resultText, durationSec };
        } catch (error) {
            const status = error?.response?.status;
            const errorMsg = error?.response?.data || error.message;
            console.error(`[KiloAPI] Query Error [HTTP ${status || 'N/A'}]:`, JSON.stringify(errorMsg));
            return { text: `⚠️ Error: Could not reach AI backend. (HTTP ${status || 'Unknown'})`, durationSec: 0 };
        }
    }
}

module.exports = new KiloAPI();
