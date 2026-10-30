import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

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
const authUsers = new Map();
const pendingOtp = new Map();

const generateToken = (seed) => `${seed}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const makeUser = ({ name, email, phone }) => ({
  id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  name: String(name || 'ContactWave User').trim() || 'ContactWave User',
  email: email ? String(email).trim().toLowerCase() : null,
  phone: phone ? String(phone).trim() : null,
  provider: email ? 'google' : 'phone',
});

const normalizePhone = (input) => {
  const value = String(input || '').replace(/\D/g, '');
  return value.length >= 10 ? `+${value}` : null;
};

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/contacts', (_, res) => {
  res.json(contacts);
});

app.post('/api/auth/google', (req, res) => {
  const { name, email } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail || !cleanName) {
    return res.status(400).json({ message: 'Google name and email are required.' });
  }

  const existingUser = authUsers.get(`google:${cleanEmail}`) || [...authUsers.values()].find((user) => user.email === cleanEmail);
  const user = existingUser || makeUser({ name: cleanName, email: cleanEmail, phone: null });

  user.name = cleanName;
  user.email = cleanEmail;
  user.provider = 'google';
  authUsers.set(`google:${cleanEmail}`, user);

  return res.json({
    token: generateToken('google'),
    user,
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
    pendingOtp.set(normalizedPhone, demoCode);
    return res.json({
      ok: true,
      message: 'OTP sent successfully.',
      demoCode,
    });
  }

  const expectedCode = pendingOtp.get(normalizedPhone) || '123456';
  if (String(otp).trim() !== expectedCode) {
    return res.status(401).json({ message: 'Invalid OTP.' });
  }

  const existingUser = authUsers.get(`phone:${normalizedPhone}`) || [...authUsers.values()].find((user) => user.phone === normalizedPhone);
  const user = existingUser || makeUser({ name: name || 'Phone User', email: null, phone: normalizedPhone });

  user.name = String(name || user.name || 'Phone User').trim() || 'Phone User';
  user.phone = normalizedPhone;
  user.provider = 'phone';
  authUsers.set(`phone:${normalizedPhone}`, user);

  return res.json({
    token: generateToken('phone'),
    user,
  });
});

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
