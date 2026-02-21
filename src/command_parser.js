const KiloAPI = require('./kilo_api');
const MemoryManager = require('./memory_manager');

class CommandParser {
    constructor() {
        this.activeModel = "minimax/minimax-m2.5:free";
        this.systemPrompt = "You are GregAI, a helpful, efficient and concise AI assistant.";
        this.isSleeping = false;
        this.lastModelList = []; // Cache for numbered model selection
        this.adminPhone = '31621313513'; // GregHuman — only user allowed to /restart
    }

    isAdmin(sender) {
        // Match against WhatsApp JID (31621313513@s.whatsapp.net) or Signal (+31621313513)
        return sender && sender.includes(this.adminPhone);
    }

    getTimestampFooter(modelName, durationSec) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const shortName = modelName.includes('/') ? modelName.split('/').pop() : modelName;
        return `\n\n${shortName} | ${durationSec}s | ${hh}:${mm}`;
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
                if (!this.isAdmin(sender)) return "Sorry, only GregHuman is allowed to restart me! 🔒";
                return { action: 'RESTART' };
            } else if (cmd === '/help') {
                // Allow /help even while sleeping
            } else {
                return null; // Ignore everything else
            }
        }

        // --- Commands ---
        if (cmd === '/sleep') {
            this.isSleeping = true;
            return "GregAI is going to sleep. Send /wakeup to resume.";
        }

        if (cmd === '/restart') {
            if (!this.isAdmin(sender)) return "Sorry, only GregHuman is allowed to restart me! 🔒";
            return { action: 'RESTART' };
        }

        if (cmd === '/help') {
            return "🛠️ *GregAI Commands:*\n" +
                "/models - List available free LLMs\n" +
                "/model/[number] - Switch LLM by number from list\n" +
                "/systemprompt - Show the current system prompt\n" +
                "/systemprompt/[prompt] - Change the AI's behavior\n" +
                "/sleep - Put the AI into sleep mode (ignores messages)\n" +
                "/wakeup - Wake up the AI from sleep mode\n" +
                "/restart - Restart the AI services\n" +
                "/help - Show this help message";
        }

        if (cmd === '/models') {
            const models = await KiloAPI.getTopFreeModels();
            this.lastModelList = models;
            const numbered = models.map((m, i) => `${i + 1}. ${m}`).join('\n');
            return `*Available Free LLMs:*\n${numbered}\n\nCurrent: ${this.activeModel}\nUse /model/[number] to switch`;
        }

        if (cmd.startsWith('/model/')) {
            const requested = cmd.replace('/model/', '').trim();

            // Ensure we have the model list cached
            if (this.lastModelList.length === 0) {
                this.lastModelList = await KiloAPI.getTopFreeModels();
            }

            // Support numeric selection (e.g. /model/3)
            const num = parseInt(requested, 10);
            if (!isNaN(num) && num >= 1 && num <= this.lastModelList.length) {
                this.activeModel = this.lastModelList[num - 1];
                return `✅ Switched to model: ${this.activeModel}`;
            }

            // Fallback: match by partial name
            const match = this.lastModelList.find(m => m.toLowerCase().includes(requested.toLowerCase()));

            if (match) {
                this.activeModel = match;
                return `✅ Switched to model: ${match}`;
            } else {
                return `❌ No model matching "${requested}". Use /models to see the numbered list.`;
            }
        }

        if (cmd === '/systemprompt') {
            return `📋 *Current System Prompt:*\n\n${this.systemPrompt}`;
        }

        if (cmd.startsWith('/systemprompt/')) {
            const newPrompt = text.trim().substring('/systemprompt/'.length).trim();
            if (newPrompt) {
                this.systemPrompt = newPrompt;
                return "System prompt updated successfully.";
            }
            return "Please provide a valid system prompt. Example: /systemprompt/[You are a pirate]";
        }

        // --- Normal LLM Query ---
        // For WhatsApp groups/LID, sender is remoteJid::participantPhone. 
        // We track memory per chat/group, so we use remoteJid.
        const chatId = platform === 'whatsapp' && sender.includes('::') ? sender.split('::')[0] : sender;
        const history = MemoryManager.getHistory(chatId);

        // Hard timeout: if the entire LLM flow takes longer than 35s, bail out
        // This prevents the event loop from blocking indefinitely
        try {
            const llmPromise = KiloAPI.queryLLM(this.activeModel, text, this.systemPrompt, history);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('LLM_TIMEOUT')), 35000)
            );

            const { text: responseText, durationSec } = await Promise.race([llmPromise, timeoutPromise]);

            // Save conversation history
            MemoryManager.addMessage(chatId, 'user', text);
            MemoryManager.addMessage(chatId, 'assistant', responseText);

            let finalResponse = responseText + this.getTimestampFooter(this.activeModel, durationSec);
            return finalResponse;
        } catch (e) {
            console.error(`[Parser] LLM query failed:`, e.message);
            if (e.message === 'LLM_TIMEOUT') {
                return `⚠️ The AI took too long to respond (>35s). Please try again.`;
            }
            return `⚠️ Error: ${e.message}`;
        }
    }
}

module.exports = new CommandParser();
