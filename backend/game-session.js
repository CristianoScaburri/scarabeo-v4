/**
 * game-session.js v3
 *
 * NEW: settings (turnDuration, maxPlayers, allowSkipWithTiles)
 * NEW: replacePlayerId / markDisconnected / markReconnected per riconnessione
 * NEW: updateSettings prima dell'avvio
 * NEW: _createdAt per pulizia stanze
 * NEW: getFullMoveHistory per pagina storico
 */

const { createBoard, isBoardEmpty, isValidPosition, isCellEmpty, serializeBoard } = require('../game-logic/board');
const { createBag, drawTiles, returnTiles, isBagEmpty, getRemainingCount } = require('../game-logic/bag');
const { findWordsFormed, validateAlignment } = require('../game-logic/word-finder');
const { calculateMoveScore, calculateWordScore, calculateFinalScores } = require('../game-logic/scoring');
const { validateWords } = require('../game-logic/dictionary');

const TILES_PER_HAND = 7;

const DEFAULT_SETTINGS = {
  turnDuration:      60,   // secondi
  maxPlayers:        4,
  allowSkipWithTiles: true,
  isPublic: true,
  roomName: ''
};

class GameSession {
  constructor(roomId) {
    this.roomId      = roomId;
    this.players     = [];
    this.board       = createBoard();
    this.bag         = createBag();
    this.currentPlayerIndex = 0;
    this.turnNumber  = 0;
    this.passCount   = 0;
    this.status      = 'waiting';
    this.chatMessages= [];
    this.turnTimer   = null;
    this.turnStartTime = null;
    this.moveHistory = [];
    this._gameOverFired = false;
    this._createdAt  = Date.now();
    this.settings    = { ...DEFAULT_SETTINGS };
    this.disconnectedIds = new Set(); // giocatori temporaneamente disconnessi
  }

  // ─── SETTINGS ───────────────────────────────────────────────
  updateSettings(patch) {
    if (typeof patch.turnDuration === 'number' && [30,60,90,120].includes(patch.turnDuration))
      this.settings.turnDuration = patch.turnDuration;
    if (typeof patch.maxPlayers === 'number' && patch.maxPlayers >= 2 && patch.maxPlayers <= 4)
      this.settings.maxPlayers = patch.maxPlayers;
    if (typeof patch.allowSkipWithTiles === 'boolean')
      this.settings.allowSkipWithTiles = patch.allowSkipWithTiles;
  }

  // ─── GESTIONE GIOCATORI ─────────────────────────────────────
  addPlayer(playerId, playerName) {
    if (this.players.length >= this.settings.maxPlayers)
      return { success: false, reason: `Stanza piena (max ${this.settings.maxPlayers})` };
    if (this.status !== 'waiting')
      return { success: false, reason: 'Partita già in corso' };
    if (this.players.some(p => p.id === playerId))
      return { success: false, reason: 'Già nella partita' };
    this.players.push({
      id: playerId, name: playerName,
      score: 0, rack: [], passes: 0,
      totalWords: 0, bestWord: null,
      disconnected: false
    });
    return { success: true };
  }

  /** Sostituisce l'ID di un giocatore (per riconnessione) */
  replacePlayerId(oldId, newId) {
    const p = this.players.find(x => x.id === oldId);
    if (p) p.id = newId;
    if (this.disconnectedIds.has(oldId)) {
      this.disconnectedIds.delete(oldId);
      this.disconnectedIds.add(newId);
    }
  }

  markDisconnected(playerId) {
    const p = this.players.find(x => x.id === playerId);
    if (p) { p.disconnected = true; this.disconnectedIds.add(playerId); }
  }

  markReconnected(playerId) {
    const p = this.players.find(x => x.id === playerId);
    if (p) { p.disconnected = false; this.disconnectedIds.delete(playerId); }
  }

  // ─── AVVIO ──────────────────────────────────────────────────
  startGame() {
    if (this.players.length < 2) return { success: false, reason: 'Servono almeno 2 giocatori' };
    this.players.forEach(p => { p.rack = drawTiles(this.bag, TILES_PER_HAND); });
    this.currentPlayerIndex = Math.floor(Math.random() * this.players.length);
    this.status = 'playing';
    this.turnNumber = 1;
    this.turnStartTime = Date.now();
    return { success: true };
  }

  // ─── MOSSA ──────────────────────────────────────────────────
  playMove(playerId, tiles) {
    if (this.status !== 'playing') return { success: false, reason: 'Partita non in corso' };
    const cp = this.players[this.currentPlayerIndex];
    if (cp.id !== playerId) return { success: false, reason: 'Non è il tuo turno' };
    if (!tiles || tiles.length === 0) return { success: false, reason: 'Devi piazzare almeno una tessera' };

    for (const t of tiles) {
      if (!isValidPosition(t.row, t.col))
        return { success: false, reason: `Posizione fuori dal tabellone: (${t.row},${t.col})` };
      if (!isCellEmpty(this.board, t.row, t.col))
        return { success: false, reason: `Casella (${t.row},${t.col}) già occupata` };
    }
    const positions = tiles.map(t => `${t.row},${t.col}`);
    if (new Set(positions).size !== positions.length)
      return { success: false, reason: 'Stessa cella usata due volte' };

    const align = validateAlignment(this.board, tiles);
    if (!align.valid) return { success: false, reason: align.reason };

    if (isBoardEmpty(this.board)) {
      if (!tiles.some(t => t.row === 7 && t.col === 7))
        return { success: false, reason: 'La prima parola deve passare per il centro (★)' };
    } else {
      if (!this.touchesExistingTile(tiles))
        return { success: false, reason: 'Le tessere devono essere adiacenti a parole già piazzate' };
    }

    const words = findWordsFormed(this.board, tiles);
    if (words.length === 0) return { success: false, reason: 'Nessuna parola formata' };

    const dict = validateWords(words);
    if (!dict.valid)
      return { success: false, reason: `Non nel dizionario: ${dict.invalidWords.join(', ')}` };

    // Piazza
    tiles.forEach(t => { this.board[t.row][t.col].letter = t.letter; this.board[t.row][t.col].value = t.value; });

    const scoreResult = calculateMoveScore(words, tiles.length);
    cp.score += scoreResult.total;
    cp.totalWords += words.length;
    words.forEach(w => {
      const ws = calculateWordScore(w);
      if (!cp.bestWord || ws > cp.bestWord.score) cp.bestWord = { word: w.word, score: ws };
    });

    this.removeTilesFromRack(cp, tiles);
    const newTiles = drawTiles(this.bag, Math.min(tiles.length, getRemainingCount(this.bag)));
    cp.rack.push(...newTiles);

    this.moveHistory.push({
      turn: this.turnNumber, playerId, playerName: cp.name,
      words: words.map(w => w.word), score: scoreResult.total,
      scrabboBonus: scoreResult.scrabboBonus, timestamp: Date.now(),
      tiles: tiles.map(t => ({ letter: t.letter, row: t.row, col: t.col }))
    });

    const ws = words.map(w => `${w.word}(+${calculateWordScore(w)})`).join(' ');
    this.addSystemMessage(`${cp.name}: ${ws} = ${scoreResult.total}pt${scoreResult.scrabboBonus ? ' 🎉SCARABEO!' : ''}`);
    cp.passes = 0; this.passCount = 0;

    const over = this.checkGameOver(cp);
    if (over && !this._gameOverFired) { this._gameOverFired = true; this.endGame(); }
    else if (!over) this.advanceTurn();

    return { success: true, wordsFormed: words.map(w => w.word), score: scoreResult.total, breakdown: scoreResult.breakdown, scrabboBonus: scoreResult.scrabboBonus, newTiles, gameOver: over };
  }

  passTurn(playerId) {
    if (this.status !== 'playing') return { success: false, reason: 'Partita non in corso' };
    const cp = this.players[this.currentPlayerIndex];
    if (cp.id !== playerId) return { success: false, reason: 'Non è il tuo turno' };
    cp.passes++; this.passCount++;
    this.addSystemMessage(`${cp.name} ha passato il turno`);
    if (this.passCount >= this.players.length * 2) {
      if (!this._gameOverFired) { this._gameOverFired = true; this.endGame(); }
      return { success: true, gameOver: true };
    }
    this.advanceTurn();
    return { success: true, gameOver: false };
  }

  exchangeTiles(playerId, indices) {
    if (this.status !== 'playing') return { success: false, reason: 'Partita non in corso' };
    const cp = this.players[this.currentPlayerIndex];
    if (cp.id !== playerId) return { success: false, reason: 'Non è il tuo turno' };
    if (!indices?.length) return { success: false, reason: 'Seleziona almeno una tessera' };
    if (getRemainingCount(this.bag) < indices.length)
      return { success: false, reason: `Solo ${getRemainingCount(this.bag)} tessere rimaste` };
    const valid = [...new Set(indices)].filter(i => i >= 0 && i < cp.rack.length);
    const toRet = valid.map(i => cp.rack[i]);
    valid.sort((a,b) => b-a).forEach(i => cp.rack.splice(i,1));
    const newT = drawTiles(this.bag, toRet.length);
    cp.rack.push(...newT);
    returnTiles(this.bag, toRet);
    this.addSystemMessage(`${cp.name} ha scambiato ${toRet.length} tessera/e`);
    this.advanceTurn();
    return { success: true, newTiles: newT };
  }

  touchesExistingTile(tiles) {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const t of tiles)
      for (const [dr,dc] of dirs) {
        const r=t.row+dr, c=t.col+dc;
        if (isValidPosition(r,c) && this.board[r][c].letter && !tiles.some(x=>x.row===r&&x.col===c)) return true;
      }
    return false;
  }

  removeTilesFromRack(player, played) {
    played.forEach(pt => {
      const idx = pt.isJolly
        ? player.rack.findIndex(r => r.letter === '?')
        : player.rack.findIndex(r => r.letter === pt.letter);
      if (idx !== -1) player.rack.splice(idx, 1);
    });
  }

  advanceTurn() {
    // Salta giocatori disconnessi (max un giro completo)
    let tries = 0;
    do {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      tries++;
    } while (this.players[this.currentPlayerIndex].disconnected && tries < this.players.length);
    this.turnNumber++;
    this.turnStartTime = Date.now();
    this.resetTurnTimer();
  }

  checkGameOver(player) {
    return player.rack.length === 0 && isBagEmpty(this.bag);
  }

  endGame() {
    this.status = 'finished';
    this.clearTurnTimer();
    const winner = this.players.find(p => p.rack.length === 0);
    const finals = calculateFinalScores(this.players, winner?.id || null);
    this.players.forEach(p => { p.score = finals[p.id]; });
    const ranking = [...this.players].sort((a,b) => b.score - a.score);
    this.addSystemMessage(`🏆 Vincitore: ${ranking[0].name} con ${ranking[0].score} punti!`);
    return ranking;
  }

  resetTurnTimer() {
    this.clearTurnTimer();
    const ms = (this.settings.turnDuration || 60) * 1000;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), ms);
  }

  clearTurnTimer() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
  }

  onTurnTimeout() {
    const cp = this.players[this.currentPlayerIndex];
    if (!cp || this.status !== 'playing') return;
    this.addSystemMessage(`⏱️ Tempo scaduto per ${cp.name}`);
    this.passTurn(cp.id);
    if (this._onTimeoutCallback) this._onTimeoutCallback(this.roomId, cp.id);
  }

  setTimeoutCallback(cb) { this._onTimeoutCallback = cb; }

  addSystemMessage(text) {
    this.chatMessages.push({ type:'system', text, timestamp: Date.now() });
    if (this.chatMessages.length > 200) this.chatMessages.shift();
  }

  addChatMessage(playerId, text) {
    const p = this.players.find(x => x.id === playerId);
    if (!p) return;
    this.chatMessages.push({ type:'chat', playerId, playerName: p.name, text: text.substring(0,200), timestamp: Date.now() });
    if (this.chatMessages.length > 200) this.chatMessages.shift();
  }

  getStateForPlayer(reqId) {
    return {
      roomId: this.roomId, status: this.status,
      board: serializeBoard(this.board),
      players: this.players.map(p => ({
        id: p.id, name: p.name, score: p.score, rackSize: p.rack.length,
        totalWords: p.totalWords, bestWord: p.bestWord, disconnected: p.disconnected,
        rack: p.id === reqId ? p.rack : null
      })),
      currentPlayerId: this.players[this.currentPlayerIndex]?.id,
      currentPlayerName: this.players[this.currentPlayerIndex]?.name,
      bagRemaining: getRemainingCount(this.bag),
      turnNumber: this.turnNumber,
      turnStartTime: this.turnStartTime,
      turnDuration: this.settings.turnDuration,
      chatMessages: this.chatMessages.slice(-50),
      moveHistory: this.moveHistory.slice(-30),
      settings: this.settings
    };
  }
}

module.exports = GameSession;
