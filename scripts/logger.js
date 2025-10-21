import { promises as fs } from 'fs';
import path from 'path';

const profiles = await loadProfiles();

async function loadProfiles() {
  try {
    const data = await fs.readFile(path.resolve(process.cwd(), "config/profiles.json"), "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error("Could not load profiles.json. Some features may not work.", e.message);
    return {};
  }
}

const logsDir = path.resolve("logs");
await fs.mkdir(logsDir, { recursive: true });

function nowIso() { return new Date().toISOString(); }

async function writeLine(file, obj) {
  try {
    const line = JSON.stringify(obj) + "\n";
    await fs.appendFile(path.join(logsDir, file), line, "utf-8");
  } catch {}
}

export async function logApiUsage(data) {
    const logPath = path.join(logsDir, 'api_usage.csv');
    const timestamp = new Date().toISOString();

    const logEntry = {
        timestamp,
        provider: data.provider || 'N/A',
        model: data.model || 'N/A',
        function: data.function || 'N/A',
        tokens_used: data.tokensUsed !== undefined ? data.tokensUsed : 'N/A',
        characters: data.characters !== undefined ? data.characters : 'N/A',
        cost_usd: data.cost !== undefined ? data.cost.toFixed(6) : 'N/A'
    };

    const headers = Object.keys(logEntry).join(',');
    const row = Object.values(logEntry).join(',');

    try {
        await fs.access(logPath);
        await fs.appendFile(logPath, row + '\n', 'utf-8');
    } catch (e) {
        // File doesn't exist, create it with headers and BOM
        await fs.writeFile(logPath, '\ufeff' + headers + '\n' + row + '\n', 'utf-8');
    }
}

export async function logEvent(event) {
  await writeLine("app.log", { ts: nowIso(), ...event });
}

export async function logServer(event) {
  await writeLine("server.log", { ts: nowIso(), ...event });
}

export function makeRateCounter(windowsMs = [1000, 5000, 10000, 60000, 300000, 3600000]) {
  const domainToTimestamps = new Map();
  return function record(domain) {
    const now = Date.now();
    if (!domainToTimestamps.has(domain)) domainToTimestamps.set(domain, []);
    const arr = domainToTimestamps.get(domain);
    arr.push(now);
    // prune older than max window
    const cutoff = now - Math.max(...windowsMs);
    while (arr.length && arr[0] < cutoff) arr.shift();
    const counts = {};
    for (const w of windowsMs) {
      const start = now - w;
      counts[w] = arr.filter(t => t >= start).length;
    }
    return counts;
  };
}

export function setupGlobalErrorHandling() {
  const errorLogPath = path.join(logsDir, "error.log");

  const handleError = async (error, origin) => {
    const timestamp = new Date().toISOString();
    const errorMessage = `${timestamp} - ${origin}\n${error.stack || error}\n\n`;
    
    console.error(`An unhandled error occurred. Details logged to ${errorLogPath}`);
    
    try {
      await fs.appendFile(errorLogPath, errorMessage, "utf-8");
    } catch (e) {
      console.error("Failed to write to error log:", e.message);
    }

    // It's generally recommended to exit after an uncaught exception
    process.exit(1);
  };

  process.on('uncaughtException', (err) => handleError(err, 'uncaughtException'));
  process.on('unhandledRejection', (reason) => handleError(reason, 'unhandledRejection'));
}


