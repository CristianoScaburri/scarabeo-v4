# 🎮 Scarabeo Online — v4

## 🆕 Novità v4

### 🔑 Login e Registrazione persistenti
- Schermata di login/registrazione all'avvio
- Password hashata con **PBKDF2-SHA512** (100k iterazioni, salt random) — nessuna dipendenza extra
- Token UUID in `localStorage` → auto-login al riavvio del browser
- I dati sopravvivono al riavvio del server (salvati in `data/users.json`)
- Accesso ospite disponibile (nessuna registrazione richiesta)

### 📜 Storico partite
- Ogni partita viene salvata in `data/history.json` con: data, giocatori, punteggi, parola migliore, durata
- La tab **"Le mie partite"** mostra le ultime 30 partite dell'utente
- Visibile via REST: `GET /api/history/:username`

### 🌍 Lobby pubbliche
- Tab **"Lobby Pubbliche"** nella schermata principale
- Lista aggiornabile con nome sala, giocatori presenti, timer, codice
- Pulsante "Entra" diretto senza digitare il codice
- Le stanze possono essere create come pubbliche o private
- Endpoint: `GET /api/lobbies`

### 🏆 Classifica globale
- Tab **"Classifica"** con top 10 giocatori per vittorie
- Mostra: vittorie, partite giocate, punteggio medio, parola migliore
- L'utente loggato è evidenziato
- Endpoint: `GET /api/leaderboard`

---

## 🚀 Avvio

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # con auto-reload (nodemon)
```

---

## 📁 Struttura v4

```
scarabeo-v4/
├── server.js                    # REST API + WebSocket
├── data/
│   ├── users.json               # Utenti registrati (persiste tra riavvii)
│   └── history.json             # Storico partite (persiste tra riavvii)
├── backend/
│   ├── auth.js                  # NUOVO: login, registrazione, token
│   ├── history-store.js         # NUOVO: salvataggio/query storico
│   ├── lobby.js                 # v4: AUTH_LINK, lobby pubbliche, storico auto-save
│   └── game-session.js          # v4: isPublic, roomName in settings
├── game-logic/  (invariato)
└── frontend/
    ├── index.html               # v4: auth screen, lobby tabs, modal create/join
    ├── style.css                # v4: auth, lobby tabs, pub rooms, history, leaderboard
    └── app.js                   # v4: REST API calls, auth flow, lobby rendering
```

---

## 🔌 REST API

| Metodo | Path | Descrizione |
|--------|------|-------------|
| `POST` | `/api/register` | Registra nuovo utente |
| `POST` | `/api/login` | Login utente |
| `POST` | `/api/logout` | Invalida token |
| `GET`  | `/api/me` | Profilo utente (richiede Bearer token) |
| `GET`  | `/api/history/:username` | Ultime 30 partite |
| `GET`  | `/api/stats/:username` | Statistiche aggregate |
| `GET`  | `/api/lobbies` | Lista lobby pubbliche in attesa |
| `GET`  | `/api/leaderboard` | Top 10 classifica |
| `GET`  | `/api/recent` | Ultime 10 partite globali |

---

## 🔒 Sicurezza note
- Le password vengono hashate con PBKDF2-SHA512, **mai memorizzate in chiaro**
- I token hanno scadenza 30 giorni e vengono invalidati al logout
- `data/` contiene dati sensibili — **non committare su repository pubblici**
