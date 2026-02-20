require('dotenv').config();
const CommandParser = require('../src/command_parser');

async function testBot() {
    console.log("=== Testing GregAI Core Router locally ===\n");

    const tests = [
        "/help",
        "/models",
        "/model/minimax",
        "Hi there! Who are you?",
        "/sleep",
        "Hey, can you awake?", // Should be ignored
        "/wakeup",
        "Hello again!"
    ];

    for (const text of tests) {
        console.log(`[USER]: ${text}`);

        try {
            const response = await CommandParser.processMessage('cli', 'mock-sender', text);
            if (response) {
                if (response.action === 'RESTART') {
                    console.log(`[GregAI]: (Action triggered: RESTART)`);
                } else {
                    console.log(`[GregAI]: ${response}`);
                }
            } else {
                console.log(`[GregAI]: (Ignored - Sleeping)`);
            }
        } catch (e) {
            console.error(`[Error] processing message:`, e);
        }
        console.log("------------------------------------------");

        // Sleep a bit so API isn't spammed
        await new Promise(r => setTimeout(r, 2000));
    }
}

testBot().then(() => console.log("\n=== Test complete ==="));
