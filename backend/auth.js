/**
 * auth.js — Sistema di autenticazione con persistenza su file
 *
 * Usa Node.js crypto built-in (pbkdf2Sync) — nessuna dipendenza extra.
 * I dati vengono salvati in data/users.json e sopravvivono ai riavvii.
 *
 * Struttura utente:
 * {
 *   username: string,
 *   passwordHash: hex string,
 *   salt: hex string,
 *   createdAt: ISO date,
 *   stats: { gamesPlayed, gamesWon, totalScore, bestWord, bestWordScore }
 * }
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '../data/users.json');

// ─── Persistenza ────────────────────────────────────────────────
function loadUsers() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Cache in memoria — sincronizzata con il file
let usersCache = loadUsers();
console.log(`👤 Auth: ${usersCache.length} utenti caricati da ${DATA_FILE}`);

// ─── Hashing ─────────────────────────────────────────────────────
const HASH_ITERATIONS = 100_000;
const HASH_LEN        = 64;
const HASH_DIGEST     = 'sha512';

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_LEN, HASH_DIGEST).toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Token semplice (UUID v4) — lato server facciamo mapping token→username ──
const tokenMap = new Map(); // token → username

function generateToken(username) {
  const token = crypto.randomUUID();
  tokenMap.set(token, username);
  // Scadenza 30 giorni
  setTimeout(() => tokenMap.delete(token), 30 * 24 * 60 * 60 * 1000);
  return token;
}

function verifyToken(token) {
  return tokenMap.get(token) || null;
}

function revokeToken(token) {
  tokenMap.delete(token);
}

// ─── API pubblica ─────────────────────────────────────────────────
/**
 * Registra un nuovo utente.
 * @returns { success, token, user } oppure { success: false, reason }
 */
function register(username, password) {
  username = (username || '').trim();

  if (!username || username.length < 2 || username.length > 20)
    return { success: false, reason: 'Il nome deve avere tra 2 e 20 caratteri' };
  if (!/^[a-zA-Z0-9_\-àèéìòù]+$/.test(username))
    return { success: false, reason: 'Il nome può contenere solo lettere, numeri, _ e -' };
  if (!password || password.length < 4)
    return { success: false, reason: 'La password deve avere almeno 4 caratteri' };
  if (usersCache.some(u => u.username.toLowerCase() === username.toLowerCase()))
    return { success: false, reason: 'Questo nome è già in uso' };

  const salt         = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const user = {
    username,
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
    stats: { gamesPlayed: 0, gamesWon: 0, totalScore: 0, bestWord: null, bestWordScore: 0 }
  };

  usersCache.push(user);
  saveUsers(usersCache);

  const token = generateToken(username);
  console.log(`👤 Nuovo utente registrato: ${username}`);
  return { success: true, token, user: publicUser(user) };
}

/**
 * Login con username e password.
 * @returns { success, token, user } oppure { success: false, reason }
 */
function login(username, password) {
  username = (username || '').trim();
  const user = usersCache.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return { success: false, reason: 'Utente non trovato' };

  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) return { success: false, reason: 'Password errata' };

  const token = generateToken(user.username);
  return { success: true, token, user: publicUser(user) };
}

/**
 * Aggiorna le statistiche di un utente dopo una partita.
 */
function updateStats(username, { won, score, bestWord, bestWordScore }) {
  const user = usersCache.find(u => u.username === username);
  if (!user) return;

  user.stats.gamesPlayed++;
  if (won)  user.stats.gamesWon++;
  user.stats.totalScore += score;
  if (bestWordScore > (user.stats.bestWordScore || 0)) {
    user.stats.bestWord      = bestWord;
    user.stats.bestWordScore = bestWordScore;
  }

  saveUsers(usersCache);
}

/**
 * Ottieni profilo pubblico (senza hash/salt).
 */
function getUser(username) {
  const u = usersCache.find(u => u.username.toLowerCase() === username.toLowerCase());
  return u ? publicUser(u) : null;
}

function publicUser(u) {
  return { username: u.username, createdAt: u.createdAt, stats: { ...u.stats } };
}

module.exports = { register, login, verifyToken, revokeToken, generateToken, updateStats, getUser };
