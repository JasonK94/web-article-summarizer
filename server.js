import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.resolve('public', 'index.html'));
});

function runScript(socket, scriptPath, args = []) {
  const process = spawn('node', [scriptPath, ...args]);

  process.stdout.on('data', (data) => {
    socket.emit('log', data.toString());
  });

  process.stderr.on('data', (data) => {
    socket.emit('log', `ERROR: ${data.toString()}`);
  });

  process.on('close', (code) => {
    socket.emit('log', `--- Script finished with code ${code} ---`);
  });
}

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('run-script', (scriptName) => {
    console.log(`Received request to run ${scriptName}`);
    const scriptPath = path.resolve('scripts', `${scriptName}.js`);
    runScript(socket, scriptPath);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
