// src/telegram.js
// Minimal Telegram sender using the Bot API. Node 18+ (global fetch/FormData/Blob).
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;

function assertEnv() {
  if (!TOKEN || !CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (see .env.example)');
  }
}

async function sendMessage(text) {
  assertEnv();
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) console.error('Telegram sendMessage failed', res.status, await res.text());
}

async function sendFile(kind, filePath, caption) {
  assertEnv();
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  if (caption) form.append('caption', caption);
  const buf = fs.readFileSync(filePath);
  form.append(kind, new Blob([buf]), path.basename(filePath));
  const res = await fetch(`${API}/send${kind === 'photo' ? 'Photo' : 'Document'}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) console.error(`Telegram send ${kind} failed`, res.status, await res.text());
}

const sendDocument = (p, c) => sendFile('document', p, c);
const sendPhoto = (p, c) => sendFile('photo', p, c);

module.exports = { sendMessage, sendDocument, sendPhoto };
