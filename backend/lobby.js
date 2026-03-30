/**
 * lobby.js v4
 * NEW: dipendenze iniettate (historyStore, auth) via costruttore
 * NEW: getPublicLobbies() per REST API
 * NEW: CREATE_ROOM accetta { isPublic, roomName }
 * NEW: AUTH_LINK — collega token utente alla sessione WS
 * NEW: GET_LOBBIES via WS (per aggiornamento real-time)
 * NEW: GET_HISTORY / GET_STATS via WS
 * NEW: salvataggio automatico storico a fine partita
 */

const { v4: uuidv4 } = require('uuid');
const GameSession = require('./game-session');

const ROOM_TTL_MS   = 30 * 60 * 1000;
const RECONN_TTL_MS = 60  * 1000;

class Lobby {
  constructor({ historyStore, auth } = {}) {
    this.rooms        = new Map(); // roomCode → GameSession
    this.players      = new Map(); // playerId → { ws, name, roomCode, username }
    this.disconnected = new Map(); // `roomCode:name` → { oldId, roomCode, expiry }
    this.historyStore = historyStore || null;
    this.auth         = auth || null;
    this._roomMeta    = new Map(); // roomCode → { startedAt, isPublic, roomName }

    setInterval(() => this._cleanRooms(), 5 * 60 * 1000);
  }

  // ─── Codice sala ────────────────────────────────────────────────
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
    while (this.rooms.has(code));
    return code;
  }

  // ─── Crea stanza ────────────────────────────────────────────────
  createRoom(playerId, playerName, options = {}) {
    const roomCode = this.generateRoomCode();
    const session  = new GameSession(roomCode);
    session.settings.isPublic  = options.isPublic  !== false; // default pubblica
    session.settings.roomName  = (options.roomName || `Sala di ${playerName}`).substring(0, 30);

    session.setTimeoutCallback((roomId, timedOutId) => {
      this.broadcastToRoom(roomId, { type: 'TURN_TIMEOUT', player: timedOutId });
      this.broadcastGameState(roomId);
    });

    this.rooms.set(roomCode, session);
    session.addPlayer(playerId, playerName);
    return { success: true, roomCode };
  }

  // ─── Entra in stanza ────────────────────────────────────────────
  joinRoom(playerId, playerName, roomCode) {
    const session = this.rooms.get(roomCode);
    if (!session) return { success: false, reason: 'Stanza non trovata. Controlla il codice.' };
    if (session.status !== 'waiting') return { success: false, reason: 'Partita già in corso' };
    if (session.players.length >= session.settings.maxPlayers)
      return { success: false, reason: `Stanza piena (max ${session.settings.maxPlayers})` };
    const r = session.addPlayer(playerId, playerName);
    if (!r.success) return r;
    return { success: true, roomCode };
  }

  // ─── Avvia partita ──────────────────────────────────────────────
  startGame(playerId) {
    const pd = this.players.get(playerId);
    if (!pd) return { success: false, reason: 'Giocatore non trovato' };
    const session = this.rooms.get(pd.roomCode);
    if (!session) return { success: false, reason: 'Stanza non trovata' };
    if (session.players[0].id !== playerId)
      return { success: false, reason: 'Solo il creatore può avviare la partita' };
    const r = session.startGame();
    if (r.success) {
      session.turnStartTime = Date.now();
      session.resetTurnTimer();
      this._roomMeta.set(pd.roomCode, {
        startedAt: new Date().toISOString(),
        isPublic:  session.settings.isPublic,
        roomName:  session.settings.roomName
      });
    }
    return r;
  }

  // ─── Player management ──────────────────────────────────────────
  registerPlayer(ws, playerId, playerName) {
    this.players.set(playerId, { ws, name: playerName, roomCode: null, username: null });
  }

  setPlayerRoom(playerId, roomCode) {
    const p = this.players.get(playerId);
    if (p) p.roomCode = roomCode;
  }

  sendToPlayer(playerId, message) {
    const p = this.players.get(playerId);
    if (p?.ws?.readyState === 1) p.ws.send(JSON.stringify(message));
  }

  broadcastToRoom(roomCode, message, excludeId = null) {
    const session = this.rooms.get(roomCode);
    if (!session) return;
    session.players.forEach(p => { if (p.id !== excludeId) this.sendToPlayer(p.id, message); });
  }

  broadcastGameState(roomCode) {
    const session = this.rooms.get(roomCode);
    if (!session) return;
    session.players.forEach(p =>
      this.sendToPlayer(p.id, { type: 'GAME_STATE', state: session.getStateForPlayer(p.id) })
    );
  }

  handleDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    const { roomCode, name } = p;
    if (roomCode) {
      const session = this.rooms.get(roomCode);
      if (session?.status === 'playing') {
        this.disconnected.set(`${roomCode}:${name}`, {
          oldId: playerId, roomCode, expiry: Date.now() + RECONN_TTL_MS
        });
        session.markDisconnected(playerId);
        session.addSystemMessage(`⚠️ ${name} si è disconnesso`);
        this.broadcastToRoom(roomCode, { type: 'PLAYER_DISCONNECTED', playerName: name, playerId });
        this.broadcastGameState(roomCode);
      }
    }
    this.players.delete(playerId);
  }

  // ─── Lobby pubbliche ────────────────────────────────────────────
  getPublicLobbies() {
    const result = [];
    for (const [code, session] of this.rooms) {
      if (session.status !== 'waiting') continue;
      if (!session.settings.isPublic) continue;
      result.push({
        roomCode:   code,
        roomName:   session.settings.roomName || code,
        players:    session.players.map(p => p.name),
        maxPlayers: session.settings.maxPlayers,
        turnDuration: session.settings.turnDuration,
        createdAgo: Math.round((Date.now() - session._createdAt) / 1000)
      });
    }
    return result.sort((a, b) => a.createdAgo - b.createdAgo);
  }

  // ─── Gestione fine partita + storico ────────────────────────────
  _onGameOver(roomCode, session) {
    if (!this.historyStore) return;
    const meta = this._roomMeta.get(roomCode) || {};
    const record = this.historyStore.saveMatch(session, meta);

    // Aggiorna stats degli utenti registrati
    if (this.auth && record) {
      session.players.forEach(p => {
        const conn = [...this.players.values()].find(x => x.roomCode === roomCode && x.name === p.name);
        const username = conn?.username || p.name;
        this.auth.updateStats(username, {
          won:          record.winner === p.name,
          score:        p.score,
          bestWord:     p.bestWord?.word || null,
          bestWordScore: p.bestWord?.score || 0
        });
      });
    }
  }

  // ─── Dispatcher messaggi WS ─────────────────────────────────────
  handleMessage(ws, playerId, message) {
    const player  = this.players.get(playerId);
    if (!player) return;
    const session = player.roomCode ? this.rooms.get(player.roomCode) : null;

    switch (message.type) {

      // ── Auth ────────────────────────────────────────────────────
      case 'AUTH_LINK': {
        // Il client invia il suo token dopo il login per collegare l'account alla sessione WS
        if (!this.auth) break;
        const username = this.auth.verifyToken(message.token);
        if (!username) { this.sendToPlayer(playerId, { type: 'AUTH_LINK_FAIL' }); break; }
        player.username = username;
        player.name     = username;
        this.sendToPlayer(playerId, { type: 'AUTH_LINK_OK', username });
        break;
      }

      // ── Lobby ───────────────────────────────────────────────────
      case 'SET_NAME':
        // Usato solo quando non si usa l'auth (ospite)
        player.name = (message.name || '').substring(0, 20).trim() || 'Ospite';
        this.sendToPlayer(playerId, { type: 'NAME_SET', name: player.name });
        break;

      case 'CREATE_ROOM': {
        if (!player.name || player.name === 'Anonimo')
          return this.sendToPlayer(playerId, { type: 'ERROR', message: 'Imposta prima il tuo nome' });
        const r = this.createRoom(playerId, player.name, {
          isPublic: message.isPublic !== false,
          roomName: message.roomName || ''
        });
        if (r.success) {
          this.setPlayerRoom(playerId, r.roomCode);
          const s = this.rooms.get(r.roomCode);
          this.sendToPlayer(playerId, {
            type: 'ROOM_CREATED', roomCode: r.roomCode,
            players: s.players.map(p => ({ id: p.id, name: p.name })),
            settings: s.settings
          });
        } else this.sendToPlayer(playerId, { type: 'ERROR', message: r.reason });
        break;
      }

      case 'JOIN_ROOM': {
        const r = this.joinRoom(playerId, player.name, message.roomCode?.toUpperCase());
        if (r.success) {
          this.setPlayerRoom(playerId, r.roomCode);
          const s = this.rooms.get(r.roomCode);
          this.broadcastToRoom(r.roomCode, {
            type: 'PLAYER_JOINED',
            players:   s.players.map(p => ({ id: p.id, name: p.name })),
            newPlayer: player.name
          });
          this.sendToPlayer(playerId, {
            type: 'ROOM_JOINED', roomCode: r.roomCode,
            players: s.players.map(p => ({ id: p.id, name: p.name })),
            settings: s.settings
          });
        } else this.sendToPlayer(playerId, { type: 'ERROR', message: r.reason });
        break;
      }

      case 'START_GAME': {
        const r = this.startGame(playerId);
        if (r.success) {
          this.broadcastGameState(player.roomCode);
          this.broadcastToRoom(player.roomCode, { type: 'GAME_STARTED' });
        } else this.sendToPlayer(playerId, { type: 'ERROR', message: r.reason });
        break;
      }

      case 'CHANGE_SETTINGS': {
        if (!session) break;
        if (session.players[0]?.id !== playerId)
          return this.sendToPlayer(playerId, { type: 'ERROR', message: 'Solo il creatore può cambiare le impostazioni' });
        if (session.status !== 'waiting') break;
        session.updateSettings(message.settings || {});
        this.broadcastToRoom(player.roomCode, { type: 'SETTINGS_UPDATED', settings: session.settings });
        break;
      }

      case 'GET_LOBBIES':
        this.sendToPlayer(playerId, { type: 'LOBBIES_LIST', lobbies: this.getPublicLobbies() });
        break;

      // ── Riconnessione ────────────────────────────────────────────
      case 'RECONNECT': {
        const key = `${message.roomCode}:${message.playerName}`;
        const dc  = this.disconnected.get(key);
        if (!dc || Date.now() > dc.expiry) {
          this.sendToPlayer(playerId, { type: 'RECONNECT_FAILED', reason: 'Sessione scaduta' });
          break;
        }
        const s = this.rooms.get(dc.roomCode);
        if (!s) { this.sendToPlayer(playerId, { type: 'RECONNECT_FAILED', reason: 'Partita non trovata' }); break; }
        s.replacePlayerId(dc.oldId, playerId);
        player.name = message.playerName;
        player.roomCode = dc.roomCode;
        this.disconnected.delete(key);
        s.markReconnected(playerId);
        s.addSystemMessage(`✅ ${player.name} si è riconnesso!`);
        this.broadcastToRoom(dc.roomCode, { type: 'PLAYER_RECONNECTED', playerName: player.name });
        this.sendToPlayer(playerId, { type: 'RECONNECTED', roomCode: dc.roomCode });
        this.broadcastGameState(dc.roomCode);
        break;
      }

      // ── Gioco ────────────────────────────────────────────────────
      case 'PLACE_TILES': {
        if (!session) return this.sendToPlayer(playerId, { type: 'ERROR', message: 'Non sei in partita' });
        const r = session.playMove(playerId, message.tiles);
        if (r.success) {
          this.broadcastToRoom(player.roomCode, {
            type: 'MOVE_PLAYED', playerId, playerName: player.name,
            words: r.wordsFormed, score: r.score, scrabboBonus: r.scrabboBonus
          });
          this.broadcastGameState(player.roomCode);
          if (r.gameOver) this._endGameBroadcast(player.roomCode, session);
        } else this.sendToPlayer(playerId, { type: 'INVALID_MOVE', reason: r.reason });
        break;
      }

      case 'PASS_TURN': {
        if (!session) break;
        const r = session.passTurn(playerId);
        if (r.success) {
          this.broadcastGameState(player.roomCode);
          if (r.gameOver) this._endGameBroadcast(player.roomCode, session);
        } else this.sendToPlayer(playerId, { type: 'ERROR', message: r.reason });
        break;
      }

      case 'EXCHANGE_TILES': {
        if (!session) break;
        const r = session.exchangeTiles(playerId, message.indices);
        if (r.success) this.broadcastGameState(player.roomCode);
        else this.sendToPlayer(playerId, { type: 'ERROR', message: r.reason });
        break;
      }

      case 'CHAT': {
        if (!session) break;
        const text = (message.text || '').substring(0, 200).trim();
        if (!text) break;
        session.addChatMessage(playerId, text);
        this.broadcastToRoom(player.roomCode, {
          type: 'CHAT', playerId, playerName: player.name, text, timestamp: Date.now()
        });
        break;
      }

      case 'REQUEST_STATE':
        if (session) this.sendToPlayer(playerId, { type: 'GAME_STATE', state: session.getStateForPlayer(playerId) });
        break;

      case 'PING':
        this.sendToPlayer(playerId, { type: 'PONG' });
        break;

      default:
        this.sendToPlayer(playerId, { type: 'ERROR', message: `Tipo sconosciuto: ${message.type}` });
    }
  }

  _endGameBroadcast(roomCode, session) {
    this._onGameOver(roomCode, session);
    this.broadcastToRoom(roomCode, {
      type: 'GAME_OVER',
      players: session.players
        .map(p => ({ id:p.id, name:p.name, score:p.score, totalWords:p.totalWords, bestWord:p.bestWord }))
        .sort((a,b) => b.score - a.score)
    });
  }

  _cleanRooms() {
    const now = Date.now();
    for (const [code, session] of this.rooms) {
      const old      = now - session._createdAt > ROOM_TTL_MS;
      const finished = session.status === 'finished';
      const empty    = session.players.length === 0;
      if (old || finished || empty) {
        session.clearTurnTimer();
        this.rooms.delete(code);
        this._roomMeta.delete(code);
        console.log(`🧹 Stanza ${code} rimossa`);
      }
    }
    for (const [k, dc] of this.disconnected)
      if (now > dc.expiry) this.disconnected.delete(k);
  }
}

module.exports = Lobby;
