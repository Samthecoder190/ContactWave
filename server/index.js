import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  getConversationBetween,
  saveMessage,
} from './db.js';

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

const broadcastMessage = (payload) => {
  const senderSocketId = socketToUser.get(payload.from);
  const targetSocketId = socketToUser.get(payload.to);

  if (senderSocketId) {
    io.to(senderSocketId).emit('receive-message', payload);
  }

  if (targetSocketId && targetSocketId !== senderSocketId) {
    io.to(targetSocketId).emit('receive-message', payload);
  }
};

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/contacts', (_, res) => {
  res.json(contacts);
});

app.get('/api/messages/:from/:to', (req, res) => {
  const from = decodeURIComponent(req.params.from || '');
  const to = decodeURIComponent(req.params.to || '');

  if (!from || !to) {
    return res.status(400).json({ error: 'Missing message participants.' });
  }

  const conversation = getConversationBetween(from, to);
  return res.json(conversation);
});

app.post('/api/messages', (req, res) => {
  const { from, to, text } = req.body || {};
  const cleanFrom = String(from || '').trim();
  const cleanTo = String(to || '').trim();
  const cleanText = String(text || '').trim();

  if (!cleanFrom || !cleanTo || !cleanText) {
    return res.status(400).json({ error: 'Message payload is incomplete.' });
  }

  try {
    const payload = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      from: cleanFrom,
      to: cleanTo,
      text: cleanText,
      timestamp: new Date().toISOString(),
    };

    const savedMessage = saveMessage(payload);
    broadcastMessage(savedMessage);
    return res.status(201).json(savedMessage);
  } catch (error) {
    console.error('Failed to save message:', error);
    return res.status(500).json({ error: 'Unable to save message.' });
  }
});

io.on('connection', (socket) => {
  socket.on('register', (username) => {
    const cleanName = String(username || 'Guest').trim() || 'Guest';

    if (socketToUser.has(cleanName) && socketToUser.get(cleanName) !== socket.id) {
      const previousSocketId = socketToUser.get(cleanName);
      if (previousSocketId) {
        io.to(previousSocketId).emit('user-status', { username: cleanName, online: false });
      }
    }

    users.set(socket.id, { username: cleanName });
    socketToUser.set(cleanName, socket.id);

    socket.emit('registered', { username: cleanName });
    socket.broadcast.emit('presence', { username: cleanName, online: true });
    io.emit('user-status', { username: cleanName, online: true });
  });

  socket.on('send-message', ({ from, to, text }) => {
    const cleanFrom = String(from || '').trim();
    const cleanTo = String(to || '').trim();
    const cleanText = String(text || '').trim();

    if (!cleanFrom || !cleanTo || !cleanText) return;

    try {
      const payload = saveMessage({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        from: cleanFrom,
        to: cleanTo,
        text: cleanText,
        timestamp: new Date().toISOString(),
      });

      broadcastMessage(payload);
    } catch (error) {
      console.error('Socket message save failed:', error);
    }
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
      const { username } = user;
      socketToUser.delete(username);
      users.delete(socket.id);
      io.emit('user-status', { username, online: false });
      socket.broadcast.emit('presence', { username, online: false });
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

