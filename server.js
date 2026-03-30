/**
 * server.js v4
 * REST API: /api/register, /api/login, /api/logout, /api/me
 *           /api/history/:user, /api/stats/:user, /api/lobbies, /api/leaderboard
 */
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');

const Auth         = require('./backend/auth');
const HistoryStore = require('./backend/history-store');

const PORT = process.env.PORT || 3000;
const app  = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Middleware auth
function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token mancante' });
  const username = Auth.verifyToken(token);
  if (!username) return res.status(401).json({ error: 'Token non valido o scaduto' });
  req.username = username;
  next();
}

// ── Auth ─────────────────────────────────────────────────────
app.post('/api/register', (req, res) => {
  const r = Auth.register(req.body?.username, req.body?.password);
  if (!r.success) return res.status(400).json({ error: r.reason });
  res.json({ token: r.token, user: r.user });
});

app.post('/api/login', (req, res) => {
  const r = Auth.login(req.body?.username, req.body?.password);
  if (!r.success) return res.status(401).json({ error: r.reason });
  res.json({ token: r.token, user: r.user });
});

app.post('/api/logout', (req, res) => {
  if (req.body?.token) Auth.revokeToken(req.body.token);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = Auth.getUser(req.username);
  if (!user) return res.status(404).json({ error: 'Non trovato' });
  res.json({ user });
});

// ── Storico ────────────────────────────────────────────────
app.get('/api/history/:username', (req, res) => {
  res.json({ history: HistoryStore.getUserHistory(req.params.username, 30) });
});

app.get('/api/stats/:username', (req, res) => {
  res.json({ stats: HistoryStore.getUserStats(req.params.username) });
});

app.get('/api/recent', (_req, res) => {
  res.json({ matches: HistoryStore.getRecentMatches(10) });
});

// ── Lobby pubbliche ─────────────────────────────────────────
app.get('/api/lobbies', (_req, res) => {
  res.json({ lobbies: lobby.getPublicLobbies() });
});

// ── Leaderboard ─────────────────────────────────────────────
app.get('/api/leaderboard', (_req, res) => {
  const all = HistoryStore.getRecentMatches(5000);
  const seen = new Set();
  all.forEach(m => m.players.forEach(p => seen.add(p.username)));
  const board = [...seen]
    .map(u => ({ username: u, ...HistoryStore.getUserStats(u) }))
    .sort((a, b) => b.gamesWon - a.gamesWon || b.avgScore - a.avgScore)
    .slice(0, 10);
  res.json({ leaderboard: board });
});

// Fallback SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ── WebSocket ───────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Lobby creata DOPO il server (accede a HistoryStore e Auth)
const Lobby = require('./backend/lobby');
const lobby = new Lobby({ historyStore: HistoryStore, auth: Auth });

wss.on('connection', (ws) => {
  const playerId = uuidv4();
  lobby.registerPlayer(ws, playerId, 'Anonimo');
  ws.send(JSON.stringify({ type: 'CONNECTED', playerId }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'PING') console.log(`📩 [${playerId.slice(0,8)}] ${msg.type}`);
      lobby.handleMessage(ws, playerId, msg);
    } catch { ws.send(JSON.stringify({ type: 'ERROR', message: 'Formato non valido' })); }
  });

  ws.on('close',  () => lobby.handleDisconnect(playerId));
  ws.on('error',  () => {});
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

const hb = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false; ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(hb));

server.listen(PORT, () => {
  console.log(`\n🎮 Scarabeo Online v4`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`🔑 Auth attiva — 📜 Storico persistente — 🌍 Lobby pubbliche\n`);
});
