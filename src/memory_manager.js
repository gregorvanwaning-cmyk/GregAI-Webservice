const fs = require('fs');
const path = require('path');

class MemoryManager {
    constructor() {
        // Persist memory to the same data directory used for Signal
        this.memoryFile = process.env.NODE_ENV === 'production'
            ? '/app/data/memory.json'
            : path.join(__dirname, '../data/memory.json');

        this.memory = {}; // { [sender]: [ { role, content, timestamp } ] }
        this.maxMessages = 50;
        this.maxAgeMs = 48 * 60 * 60 * 1000; // 48 hours

        this._loadMemory();

        // Save periodically (every 5 minutes) to avoid thrashing on every message
        setInterval(() => this._saveMemory(), 5 * 60 * 1000);
    }

    _loadMemory() {
        try {
            if (fs.existsSync(this.memoryFile)) {
                const data = fs.readFileSync(this.memoryFile, 'utf8');
                this.memory = JSON.parse(data);
                this._cleanupAll();
                console.log(`[Memory] Loaded conversation history for ${Object.keys(this.memory).length} users.`);
            } else {
                // Ensure directory exists
                const dir = path.dirname(this.memoryFile);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            }
        } catch (e) {
            console.error(`[Memory] Error loading memory:`, e);
        }
    }

    _saveMemory() {
        try {
            this._cleanupAll(); // Clean before saving to save disk space
            fs.writeFileSync(this.memoryFile, JSON.stringify(this.memory), 'utf8');
        } catch (e) {
            console.error(`[Memory] Error saving memory:`, e);
        }
    }

    _cleanupAll() {
        const now = Date.now();
        for (const sender in this.memory) {
            this.memory[sender] = this.memory[sender].filter(msg => (now - msg.timestamp) < this.maxAgeMs);
            if (this.memory[sender].length === 0) {
                delete this.memory[sender];
            }
        }
    }

    addMessage(sender, role, content) {
        if (!this.memory[sender]) this.memory[sender] = [];

        this.memory[sender].push({
            role,
            content,
            timestamp: Date.now()
        });

        // Enforce 50-message limit
        if (this.memory[sender].length > this.maxMessages) {
            this.memory[sender] = this.memory[sender].slice(-this.maxMessages);
        }
    }

    getHistory(sender) {
        if (!this.memory[sender]) return [];

        const now = Date.now();
        // Return formatted for LLM, filtering out expired ones live
        return this.memory[sender]
            .filter(msg => (now - msg.timestamp) < this.maxAgeMs)
            .map(msg => ({ role: msg.role, content: msg.content }));
    }
}

module.exports = new MemoryManager();
