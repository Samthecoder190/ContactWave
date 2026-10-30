import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const usersFile = path.join(dataDir, 'users.json');
const messagesFile = path.join(dataDir, 'messages.json');
const otpsFile = path.join(dataDir, 'otps.json');

const ensureFile = (filePath, defaultValue) => {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
};

const readJson = (filePath, fallback) => {
  try {
    const file = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(file || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const ensureStore = () => {
  ensureFile(usersFile, []);
  ensureFile(messagesFile, []);
  ensureFile(otpsFile, {});
};

export const listUsers = () => {
  ensureStore();
  return readJson(usersFile, []);
};

export const listMessages = () => {
  ensureStore();
  return readJson(messagesFile, []);
};

export const getUserByEmail = (email) => {
  if (!email) return null;
  return listUsers().find((user) => user.email && user.email.toLowerCase() === email.toLowerCase()) || null;
};

export const getUserByPhone = (phone) => {
  if (!phone) return null;
  return listUsers().find((user) => user.phone && user.phone === phone) || null;
};

export const upsertUser = ({ id, name, email, phone, provider, image }) => {
  const users = listUsers();

  const match = users.find(
    (user) =>
      (email && user.email && user.email.toLowerCase() === String(email).toLowerCase()) ||
      (phone && user.phone && user.phone === String(phone)) ||
      (id && user.id === String(id)),
  );

  const normalizedUser = {
    id: match?.id || id || crypto.randomUUID(),
    name: String(name || match?.name || 'ContactWave User').trim() || 'ContactWave User',
    email: email ? String(email).trim().toLowerCase() : match?.email || null,
    phone: phone ? String(phone).trim() : match?.phone || null,
    provider: provider || match?.provider || 'local',
    image: image || match?.image || null,
    createdAt: match?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (match) {
    const updatedUsers = users.map((user) => (user.id === match.id ? normalizedUser : user));
    writeJson(usersFile, updatedUsers);
    return normalizedUser;
  }

  users.push(normalizedUser);
  writeJson(usersFile, users);
  return normalizedUser;
};

export const saveMessage = (message) => {
  const messages = listMessages();
  const record = {
    id: message.id || crypto.randomUUID(),
    from: String(message.from || '').trim(),
    to: String(message.to || '').trim(),
    text: String(message.text || '').trim(),
    timestamp: message.timestamp || new Date().toISOString(),
  };

  if (!record.from || !record.to || !record.text) {
    throw new Error('Message payload is incomplete.');
  }

  messages.push(record);
  writeJson(messagesFile, messages);
  return record;
};

export const getConversationBetween = (from, to) => {
  const messages = listMessages();
  return messages.filter(
    (message) =>
      (message.from === from && message.to === to) ||
      (message.from === to && message.to === from),
  );
};

export const setPendingOtp = (phone, code) => {
  ensureStore();
  const data = readJson(otpsFile, {});
  data[phone] = {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
  writeJson(otpsFile, data);
  return code;
};

export const getPendingOtp = (phone) => {
  ensureStore();
  const data = readJson(otpsFile, {});
  const entry = data[phone];

  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete data[phone];
    writeJson(otpsFile, data);
    return null;
  }

  return entry.code;
};

export const clearPendingOtp = (phone) => {
  ensureStore();
  const data = readJson(otpsFile, {});
  delete data[phone];
  writeJson(otpsFile, data);
};
