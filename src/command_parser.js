const KiloAPI = require('./kilo_api');

class CommandParser {
    constructor() {
        this.activeModel = "minimax/minimax-m2.5:free";
        this.systemPrompt = "You are GregAI, a helpful, efficient and concise AI assistant.";
        this.isSleeping = false;
    }

    getTimestampFooter(modelName, durationSec) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        return `\n\n_${modelName} | ${durationSec}s | ${hh}:${mm}_`;
    }

    async processMessage(platform, sender, text) {
        if (!text) {
            console.error(`[Parser] Received undefined text from ${platform}:${sender}`);
            return null;
        }

        console.log(`[Parser] Processing ${platform} from ${sender}: "${text}"`);
        const cmd = text.trim().toLowerCase();

        // Check explicit wake commands if asleep
        if (this.isSleeping) {
            if (cmd === '/wakeup') {
                this.isSleeping = false;
                return "GregAI is now awake and ready to assist.";
            } else if (cmd === '/restart') {
                // Return special flag for router to handle
                return { action: 'RESTART' };
            }
            return null; // Ignore everything else
        }

        // --- Commands ---
        if (cmd === '/sleep') {
            this.isSleeping = true;
            return "GregAI is going to sleep. Send /wakeup to resume.";
        }

        if (cmd === '/restart') {
            return { action: 'RESTART' };
        }

        if (cmd === '/help') {
            return "🛠️ *GregAI Commands:*\n" +
                "/models - List top 5 available free LLMs\n" +
                "/model/[name] - Switch to a specific LLM\n" +
                "/systemprompt/[prompt] - Change the AI's behavior\n" +
                "/sleep - Put the AI into sleep mode (ignores messages)\n" +
                "/wakeup - Wake up the AI from sleep mode\n" +
                "/restart - Restart the AI services\n" +
                "/help - Show this help message";
        }

        if (cmd === '/models') {
            const models = await KiloAPI.getTopFreeModels();
            return "*Available Free LLMs:*\n- " + models.join('\n- ');
        }

        if (cmd.startsWith('/model/')) {
            const requested = cmd.replace('/model/', '').trim().toLowerCase();
            const models = await KiloAPI.getTopFreeModels();
            const match = models.find(m => m.toLowerCase().includes(requested));

            if (match) {
                this.activeModel = match;
                return `Successfully switched to model: ${match}`;
            } else {
                return `Could not find a free model matching "${requested}". Use /models to see the list.`;
            }
        }

        if (cmd.startsWith('/systemprompt/')) {
            const newPrompt = cmd.replace(/\/systemprompt\/?/, '').trim();
            if (newPrompt) {
                this.systemPrompt = newPrompt;
                return "System prompt updated successfully.";
            }
            return "Please provide a valid system prompt. Example: /systemprompt/[You are a pirate]";
        }

        // --- Normal LLM Query ---
        const { text: responseText, durationSec } = await KiloAPI.queryLLM(this.activeModel, cmd, this.systemPrompt);

        let finalResponse = responseText + this.getTimestampFooter(this.activeModel, durationSec);
        return finalResponse;
    }
}

module.exports = new CommandParser();
