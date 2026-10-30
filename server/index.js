import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 4000;
const frontendDist = path.resolve(__dirname, '../client/dist');

app.use(cors());
app.use(express.json());

const contacts = [
  { id: 1, name: 'Ava', status: 'Online', avatar: 'A' },
  { id: 2, name: 'Leo', status: 'Away', avatar: 'L' },
  { id: 3, name: 'Maya', status: 'Online', avatar: 'M' },
  { id: 4, name: 'Noah', status: 'Offline', avatar: 'N' },
  { id: 5, name: 'Sofia', status: 'Online', avatar: 'S' },
];

const users = new Map();
const socketToUser = new Map();

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/contacts', (_, res) => {
  res.json(contacts);
});

io.on('connection', (socket) => {
  socket.on('register', (username) => {
    const cleanName = String(username || 'Guest').trim() || 'Guest';
    users.set(socket.id, { username: cleanName });
    socketToUser.set(cleanName, socket.id);

    socket.emit('registered', { username: cleanName });
    socket.broadcast.emit('presence', { username: cleanName, online: true });
    io.emit('user-status', { username: cleanName, online: true });
  });

  socket.on('send-message', ({ from, to, text }) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || !to) return;

    const payload = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      from,
      to,
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    const targetSocketId = socketToUser.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('receive-message', payload);
    }

    socket.emit('receive-message', payload);
  });

  socket.on('start-call', ({ from, to }) => {
    const targetSocketId = socketToUser.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', { from, to });
    }
  });

  socket.on('offer', ({ from, to, offer }) => {
    const targetSocketId = socketToUser.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-offer', { from, offer });
    }
  });

  socket.on('answer', ({ from, to, answer }) => {
    const targetSocketId = socketToUser.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-answer', { from, answer });
    }
  });

  socket.on('ice-candidate', ({ from, to, candidate }) => {
    const targetSocketId = socketToUser.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-ice-candidate', { from, candidate });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      socketToUser.delete(user.username);
      users.delete(socket.id);
      io.emit('user-status', { username: user.username, online: false });
      socket.broadcast.emit('presence', { username: user.username, online: false });
    }
  });
});

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`ContactWave server running on http://localhost:${PORT}`);
});
