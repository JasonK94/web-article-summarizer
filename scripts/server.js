import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import http from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Argument Parsing for Port ---
let port = 3000; // Default port
const portArgIndex = process.argv.findIndex(arg => arg === '-p' || arg === '--port');
if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsedPort = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(parsedPort)) {
        port = parsedPort;
    }
}
// --- End Argument Parsing ---

const DATA_DIR = path.join(process.cwd(), 'data');
const RUNS_FILE_PATH = path.join(DATA_DIR, '4_runs', 'all_runs.csv');
const EDITED_FILE_PATH = path.join(DATA_DIR, '5_edited', 'edited_runs.csv');
const PROCESSED_FILE_PATH = path.join(DATA_DIR, '2_processed', 'processed_content.csv');
const CONFIG_PATH = path.join(process.cwd(), 'config', 'profiles.json');

app.use(express.static('public'));

app.get('/api/profiles', async (req, res) => {
    try {
        const configData = await fs.readFile(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(configData);
        const enhancerProfiles = config.enhancers ? Object.keys(config.enhancers) : [];
        res.json(enhancerProfiles);
    } catch (error) {
        console.error("Failed to read or parse profiles.json:", error);
        res.status(500).json({ error: 'Failed to load profiles.' });
    }
});

app.get('/api/runs', async (req, res) => {
    try {
        // 1. Read Drafts
        const runsCsvData = await fs.readFile(RUNS_FILE_PATH, 'utf-8');
        const drafts = parse(runsCsvData, { columns: true, skip_empty_lines: true, bom: true });

        // 2. Read Edits
        let editsMap = new Map();
        try {
            const editedCsvData = await fs.readFile(EDITED_FILE_PATH, 'utf-8');
            const edits = parse(editedCsvData, { columns: true, skip_empty_lines: true, bom: true });
            edits.forEach(edit => {
                const key = `${edit.run_id}-${edit.editor_profile}`;
                if (!editsMap.has(key)) editsMap.set(key, {});
                // Merge edits for the same run_id and profile
                Object.assign(editsMap.get(key), edit);
            });
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
            console.log('No edited runs file found, proceeding with drafts only.');
        }

        // 3. Merge Drafts and Edits
        const combinedRuns = drafts.map(draft => {
            const run_id = draft.run_id;
            let merged = { ...draft };
            for (const [key, editData] of editsMap.entries()) {
                if (key.startsWith(`${run_id}-`)) {
                    // This logic assumes you might have multiple edits per run_id
                    // We can simplify if it's always one profile
                    merged = { ...merged, ...editData };
                }
            }
            return merged;
        });

        res.json(combinedRuns);
    } catch (error) {
        console.error("Failed to process run data:", error);
        res.status(500).json({ error: 'Failed to load run data.' });
    }
});

app.get('/api/sources', async (req, res) => {
    const ids = req.query.ids ? req.query.ids.split(',') : [];
    if (ids.length === 0) {
        return res.status(400).json({ error: 'No source IDs provided.' });
    }

    try {
        const processedCsv = await fs.readFile(PROCESSED_FILE_PATH, 'utf-8');
        const allSources = parse(processedCsv, { columns: true, bom: true });
        const sourceMap = new Map(allSources.map(s => [s.processed_id, s]));
        
        const results = ids.map(id => sourceMap.get(id) || { processed_id: id, title: 'Source not found', content: '' });
        res.json(results);
    } catch (error) {
        console.error("Failed to read or parse processed_content.csv:", error);
        res.status(500).json({ error: 'Failed to load source data.' });
    }
});

// --- WebSocket Script Runner ---
io.on('connection', (socket) => {
    console.log('GUI client connected');

    const runScript = (scriptName, args = []) => {
        const scriptPath = path.join(process.cwd(), 'scripts', 'pipeline', `${scriptName}.js`);
        socket.emit('log', `--- Starting ${scriptName}.js with args: [${args.join(', ')}] ---\n`);
        const child = spawn('node', [scriptPath, ...args]);

        child.stdout.on('data', (data) => socket.emit('log', data.toString()));
        child.stderr.on('data', (data) => socket.emit('log', `ERROR: ${data.toString()}`));
        child.on('close', (code) => socket.emit('log', `--- Script ${scriptName}.js finished with code ${code} ---\n`));
    };

    socket.on('run-step', async ({ step, profile }) => {
        if (step === '1') runScript('1_process_raw');
        if (step === '2') runScript('2_generate_content');
        if (step === '3') {
            const editorProfile = profile || 'professional'; // Fallback to default
            runScript('3_edit_content', ['--profile', editorProfile]);
        }
        if (step === 'all') {
            // This is a simplified sequential runner. A more robust implementation
            // would wait for each 'close' event before starting the next.
            runScript('1_process_raw');
            // For now, we just trigger them. Proper sequential execution needs more logic.
            setTimeout(() => runScript('2_generate_content'), 10000); // Bad: fixed delay
            setTimeout(() => runScript('3_edit_content', ['--profile', 'professional']), 20000);
        }
    });

    socket.on('disconnect', () => console.log('GUI client disconnected'));
});


server.listen(port, () => {
    console.log(`📈 Content viewer GUI is running at http://localhost:${port}`);
});
