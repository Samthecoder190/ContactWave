import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  upsertUser,
  getUserByEmail,
  getUserByPhone,
  setPendingOtp,
  getPendingOtp,
  clearPendingOtp,
  saveMessage,
  getConversationBetween,
} from './db.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 4000;

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

const generateToken = (seed) => `${seed}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const normalizePhone = (input) => {
  const value = String(input || '').replace(/\D/g, '');
  return value.length >= 10 ? `+${value}` : null;
};

const toPublicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email || null,
  phone: user.phone || null,
  provider: user.provider || 'local',
  image: user.image || null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/contacts', (_, res) => {
  res.json(contacts);
});

app.get('/api/users', (_, res) => {
  const allUsers = awaitUsers();
  res.json(allUsers.map(toPublicUser));
});

app.get('/api/messages/:from/:to', (req, res) => {
  const { from, to } = req.params;
  const conversation = getConversationBetween(from, to);
  res.json(conversation);
});

app.post('/api/auth/google', (req, res) => {
  const { name, email } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail || !cleanName) {
    return res.status(400).json({ message: 'Google name and email are required.' });
  }

  const existingUser = getUserByEmail(cleanEmail);
  const user = upsertUser({
    id: existingUser?.id,
    name: cleanName,
    email: cleanEmail,
    phone: existingUser?.phone || null,
    provider: 'google',
  });

  return res.json({
    token: generateToken('google'),
    user: toPublicUser(user),
  });
});

app.post('/api/auth/phone', (req, res) => {
  const { phone, otp, name } = req.body || {};
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return res.status(400).json({ message: 'Provide a valid phone number.' });
  }

  if (!otp) {
    const demoCode = '123456';
    setPendingOtp(normalizedPhone, demoCode);
    return res.json({
      ok: true,
      message: 'OTP sent successfully.',
      demoCode,
    });
  }

  const expectedCode = getPendingOtp(normalizedPhone) || '123456';
  if (String(otp).trim() !== expectedCode) {
    return res.status(401).json({ message: 'Invalid OTP.' });
  }

  const existingUser = getUserByPhone(normalizedPhone);
  const user = upsertUser({
    id: existingUser?.id,
    name: String(name || existingUser?.name || 'Phone User').trim() || 'Phone User',
    email: existingUser?.email || null,
    phone: normalizedPhone,
    provider: 'phone',
  });

  clearPendingOtp(normalizedPhone);

  return res.json({
    token: generateToken('phone'),
    user: toPublicUser(user),
  });
});

app.post('/api/messages', (req, res) => {
  try {
    const { from, to, text } = req.body || {};
    const message = saveMessage({
      from: String(from || '').trim(),
      to: String(to || '').trim(),
      text: String(text || '').trim(),
      timestamp: new Date().toISOString(),
    });

    // Broadcast to Socket.IO recipients if they are connected.
    io.emit('receive-message', message);
    res.json(message);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to save message.' });
  }
});

const awaitUsers = () => {
  const current = []; 
  const stored = globalThis.__CONTACTWAVE_USERS__ || [];
  return current.length ? current : stored;
};

io.on('connection', (socket) => {
  socket.on('register', (user) => {
    const safeUser = {
      id: user?.id || socket.id,
      name: String(user?.name || 'Guest').trim() || 'Guest',
      email: user?.email || null,
      phone: user?.phone || null,
      provider: user?.provider || 'anonymous',
    };

    users.set(socket.id, safeUser);
    socketToUser.set(safeUser.name, socket.id);

    socket.emit('registered', { user: safeUser });
    socket.broadcast.emit('presence', { username: safeUser.name, online: true });
    io.emit('user-status', { username: safeUser.name, online: true });
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

    try {
      saveMessage(payload);
    } catch {
      // Ignore storage error for demo runtime; still emit message.
    }

    socket.emit('receive-message', payload);

    const targetSocketId = socketToUser.get(to);
    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit('receive-message', payload);
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
      socketToUser.delete(user.name);
      users.delete(socket.id);
      io.emit('user-status', { username: user.name, online: false });
      socket.broadcast.emit('presence', { username: user.name, online: false });
    }
  });
});

server.listen(PORT, () => {
  console.log(`ContactWave server running on http://localhost:${PORT}`);
});
