import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not found in .env file.");
    process.exit(1);
}

const genai = new GoogleGenerativeAI(GEMINI_API_KEY);

async function listModels() {
    try {
        console.log("Fetching available models from Google Generative AI...");
        const result = await genai.listModels();

        console.log("Available models:");
        for await (const m of result) {
            if (m.supportedGenerationMethods.includes('generateContent')) {
                 console.log(`- ${m.name}`);
            }
        }
    } catch (error) {
        console.error("Error fetching models:", error);
    }
}

listModels();

