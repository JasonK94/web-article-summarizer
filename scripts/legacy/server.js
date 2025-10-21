const express = require('express');
const { promises: fs } = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const port = 3000;

const DATA_DIR = path.join(process.cwd(), 'data');
const RUNS_FILE_PATH = path.join(DATA_DIR, '4_runs', 'all_runs.csv');

app.use(express.static('public'));

app.get('/api/runs', async (req, res) => {
    try {
        const csvData = await fs.readFile(RUNS_FILE_PATH, 'utf-8');
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            bom: true
        });
        res.json(records);
    } catch (error) {
        console.error("Failed to read or parse all_runs.csv:", error);
        res.status(500).json({ error: 'Failed to load run data.' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log('Serving content from all_runs.csv');
});
