const axios = require('axios');

class KiloAPI {
    constructor() {
        this.apiKey = process.env.KILO_API_KEY;
        this.baseUrl = 'https://api.kilocode.com/v1'; // Assuming standard OpenAI-compatible URL structure for Kilo
    }

    async getTopFreeModels() {
        // Mock method until actual endpoints are specified by the Kilo Code documentation
        // Let's assume Kilo uses openai-compatible `/models` endpoint
        try {
            const response = await axios.get(`${this.baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });

            // Filter out models that might be paid or just grab all. 
            // In absence of exact api schema, just assume standard response.
            let models = response.data.data.map(m => m.id);
            // Limit to 5
            return models.slice(0, 5);
        } catch (error) {
            console.error('[KiloAPI] Error fetching models:', error?.response?.data || error.message);
            // Fallback list of generic free models for testing if API fails
            return ["minimax", "qwen-2.5-coder-32b", "llama-3-8b", "mistral-7b", "gemma-2b"];
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
            console.error('[KiloAPI] Query Error:', error?.response?.data || error.message);
            return { text: `[Error: Failed to fetch response from ${modelName}]`, durationSec: 0 };
        }
    }
}

module.exports = new KiloAPI();
