/**
 * history-store.js — Storico partite persistente su file JSON
 *
 * Ogni record salvato:
 * {
 *   id: uuid,
 *   roomCode: string,
 *   roomName: string,
 *   startedAt: ISO,
 *   endedAt: ISO,
 *   durationSeconds: number,
 *   players: [{ username, score, rank, totalWords, bestWord }],
 *   winner: username,
 *   isPublic: boolean
 * }
 *
 * Indicizzato per username per query rapide.
 */

const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/history.json');
const MAX_RECORDS = 10_000; // limite totale per non far crescere il file a dismisura

// Cache in memoria
let historyCache = load();
console.log(`📜 History: ${historyCache.length} partite caricate`);

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function save() {
  // Tieni solo le ultime MAX_RECORDS partite
  if (historyCache.length > MAX_RECORDS) historyCache = historyCache.slice(-MAX_RECORDS);
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyCache, null, 2), 'utf8');
}

/**
 * Salva il risultato di una partita.
 * @param {object} session - istanza GameSession
 * @param {object} meta    - { roomName, startedAt, isPublic }
 */
function saveMatch(session, meta = {}) {
  if (!session || session.players.length < 2) return;

  const sorted = [...session.players].sort((a, b) => b.score - a.score);
  const record = {
    id:              require('crypto').randomUUID(),
    roomCode:        session.roomId,
    roomName:        meta.roomName || session.roomId,
    startedAt:       meta.startedAt || new Date().toISOString(),
    endedAt:         new Date().toISOString(),
    durationSeconds: meta.startedAt
      ? Math.round((Date.now() - new Date(meta.startedAt).getTime()) / 1000)
      : 0,
    players: sorted.map((p, i) => ({
      username:   p.name,
      score:      p.score,
      rank:       i + 1,
      totalWords: p.totalWords || 0,
      bestWord:   p.bestWord   || null
    })),
    winner:   sorted[0].name,
    isPublic: meta.isPublic || false,
    totalTurns: session.turnNumber || 0
  };

  historyCache.push(record);
  save();
  console.log(`📜 Partita salvata: ${record.roomCode} — vincitore: ${record.winner}`);
  return record;
}

/**
 * Restituisce le ultime N partite di un utente (per username).
 */
function getUserHistory(username, limit = 20) {
  return historyCache
    .filter(r => r.players.some(p => p.username.toLowerCase() === username.toLowerCase()))
    .slice(-limit)
    .reverse() // più recenti prima
    .map(r => ({
      ...r,
      myResult: r.players.find(p => p.username.toLowerCase() === username.toLowerCase())
    }));
}

/**
 * Restituisce le statistiche aggregate di un utente.
 */
function getUserStats(username) {
  const games = historyCache.filter(r =>
    r.players.some(p => p.username.toLowerCase() === username.toLowerCase())
  );
  if (games.length === 0) return { gamesPlayed: 0, gamesWon: 0, avgScore: 0, bestWord: null };

  let won = 0, totalScore = 0, bestWord = null, bestWordScore = 0;
  games.forEach(r => {
    const me = r.players.find(p => p.username.toLowerCase() === username.toLowerCase());
    if (!me) return;
    if (r.winner.toLowerCase() === username.toLowerCase()) won++;
    totalScore += me.score;
    if (me.bestWord && me.bestWord.score > bestWordScore) {
      bestWord      = me.bestWord.word;
      bestWordScore = me.bestWord.score;
    }
  });

  return {
    gamesPlayed: games.length,
    gamesWon:    won,
    avgScore:    Math.round(totalScore / games.length),
    bestWord,
    bestWordScore
  };
}

/**
 * Ultime N partite globali (per leaderboard/feed pubblico).
 */
function getRecentMatches(limit = 10) {
  return historyCache.slice(-limit).reverse();
}

module.exports = { saveMatch, getUserHistory, getUserStats, getRecentMatches };
