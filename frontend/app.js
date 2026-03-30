/**
 * app.js v4 — Scarabeo Online
 *
 * NUOVO:
 * - Login / Registrazione via REST API (/api/login, /api/register)
 * - Token salvato in localStorage (persiste tra le sessioni)
 * - Lobby pubblica con lista stanze aggiornabile (/api/lobbies via WS e REST)
 * - Storico partite personale (/api/history/:username)
 * - Classifica globale (/api/leaderboard)
 * - Schermata attesa separata da lobby
 * - AUTH_LINK: collega token WS all'account registrato
 * - Creazione stanza con nome, visibilità pubblica/privata
 */

// ────────────────────────────────────────────────
// GAMEAPI ADAPTER (invariato dalla v3)
// ────────────────────────────────────────────────
const GameApi = {
  state:{}, actors:[], _handlers:{},
  update(d){ if(gameState.status==='playing') tickTimer(); },
  addActor(a){ this.actors.push(a); return a; },
  removeActor(id){ this.actors=this.actors.filter(a=>a.id!==id); },
  setState(s){ Object.assign(this.state,s); },
  emit(ev,d){ (this._handlers[ev]||[]).forEach(h=>h(d)); },
  on(ev,fn){ if(!this._handlers[ev])this._handlers[ev]=[]; this._handlers[ev].push(fn); }
};
requestAnimationFrame(function loop(){ GameApi.update(); requestAnimationFrame(loop); });

// ────────────────────────────────────────────────
// STATO
// ────────────────────────────────────────────────
let ws=null, reconnTimer=null;
let myId=null, myName='', myRoom='', myToken=null, myUsername=null;
let isCreator=false;
let nameConfirmed=false; // NUOVO: traccia se il nome è confermato
let gameState={status:'waiting',board:[],players:[],rack:[],bagRemaining:98};
let pending=[], selIdx=null, soundOn=true, audioCtx=null, fullMoveHistory=[];
let kbRow=7, kbCol=7, kbActive=false, kbDir='h';
let exSel=new Set();

const TURN_MS_DEFAULT=60000;
const CELL_LABELS={TW:'T.P.',DW:'D.P.',TL:'T.L.',DL:'D.L.',CT:'★',N:''};
const BONUS_LAYOUT=[
  ['TW','N','N','DL','N','N','N','TW','N','N','N','DL','N','N','TW'],
  ['N','DW','N','N','N','TL','N','N','N','TL','N','N','N','DW','N'],
  ['N','N','DW','N','N','N','DL','N','DL','N','N','N','DW','N','N'],
  ['DL','N','N','DW','N','N','N','DL','N','N','N','DW','N','N','DL'],
  ['N','N','N','N','DW','N','N','N','N','N','DW','N','N','N','N'],
  ['N','TL','N','N','N','TL','N','N','N','TL','N','N','N','TL','N'],
  ['N','N','DL','N','N','N','DL','N','DL','N','N','N','DL','N','N'],
  ['TW','N','N','DL','N','N','N','CT','N','N','N','DL','N','N','TW'],
  ['N','N','DL','N','N','N','DL','N','DL','N','N','N','DL','N','N'],
  ['N','TL','N','N','N','TL','N','N','N','TL','N','N','N','TL','N'],
  ['N','N','N','N','DW','N','N','N','N','N','DW','N','N','N','N'],
  ['DL','N','N','DW','N','N','N','DL','N','N','N','DW','N','N','DL'],
  ['N','N','DW','N','N','N','DL','N','DL','N','N','N','DW','N','N'],
  ['N','DW','N','N','N','TL','N','N','N','TL','N','N','N','DW','N'],
  ['TW','N','N','DL','N','N','N','TW','N','N','N','DL','N','N','TW']
];
const LM={DL:2,TL:3}, WM={DW:2,CT:2,TW:3};

// ────────────────────────────────────────────────
// AUTH — localStorage + REST API
// ────────────────────────────────────────────────
function loadSavedToken() {
  try { return JSON.parse(localStorage.getItem('scarabeo_auth')); } catch { return null; }
}
function saveToken(token, username) {
  localStorage.setItem('scarabeo_auth', JSON.stringify({ token, username }));
}
function clearToken() {
  localStorage.removeItem('scarabeo_auth');
}

async function apiCall(method, path, body=null, token=null) {
  const opts = { method, headers:{ 'Content-Type':'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

async function tryAutoLogin() {
  const saved = loadSavedToken();
  if (!saved?.token) return false;
  const data = await apiCall('GET', '/api/me', null, saved.token);
  if (data.user) {
    myToken    = saved.token;
    myUsername = data.user.username;
    myName     = data.user.username;
    return data.user;
  }
  clearToken();
  return false;
}

async function doLogin(username, password) {
  const data = await apiCall('POST', '/api/login', { username, password });
  if (data.error) return { success:false, reason:data.error };
  myToken    = data.token;
  myUsername = data.user.username;
  myName     = data.user.username;
  saveToken(data.token, myUsername);
  return { success:true, user:data.user };
}

async function doRegister(username, password) {
  const data = await apiCall('POST', '/api/register', { username, password });
  if (data.error) return { success:false, reason:data.error };
  myToken    = data.token;
  myUsername = data.user.username;
  myName     = data.user.username;
  saveToken(data.token, myUsername);
  return { success:true, user:data.user };
}

async function doLogout() {
  if (myToken) await apiCall('POST', '/api/logout', { token:myToken });
  clearToken();
  myToken=null; myUsername=null; myName='';
  location.reload();
}

// ────────────────────────────────────────────────
// WEBSOCKET
// ────────────────────────────────────────────────
function connectWs() {
  const proto = location.protocol==='https:'?'wss:':'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen    = onWsOpen;
  ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch(x){ console.error(x); } };
  ws.onclose   = () => { clearTimeout(reconnTimer); reconnTimer=setTimeout(connectWs, 2500); };
  ws.onerror   = () => ws.close();
}
function onWsOpen() {
  clearTimeout(reconnTimer);
  // Collega il token all'account
  if (myToken) send('AUTH_LINK', { token:myToken });
  // Riconnessione partita in corso
  const sc = getSavedSession();
  if (sc && gameState.status!=='playing') {
    send('RECONNECT', { roomCode:sc.room, playerName:sc.name });
  }
}
function send(type, data={}) {
  if (ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type,...data}));
}

function getSavedSession() {
  try {
    const d=JSON.parse(sessionStorage.getItem('scarabeo_session')||'null');
    if (!d) return null;
    if (Date.now()-d.ts>55000) { sessionStorage.removeItem('scarabeo_session'); return null; }
    return d;
  } catch{ return null; }
}
function saveSession(name,room) {
  try { sessionStorage.setItem('scarabeo_session',JSON.stringify({name,room,ts:Date.now()})); } catch{}
}
function clearSession() { try{ sessionStorage.removeItem('scarabeo_session'); }catch{} }

// ────────────────────────────────────────────────
// DISPATCHER
// ────────────────────────────────────────────────
function handle(msg) {
  switch(msg.type) {
    case 'CONNECTED':   myId=msg.playerId; break;
    case 'AUTH_LINK_OK': 
      console.log('✅ Auth collegata:', msg.username); 
      nameConfirmed=true; 
      enableLobbyButtons();
      break;
    case 'NAME_SET': 
      console.log('✅ Nome impostato:', msg.name); 
      nameConfirmed=true;
      enableLobbyButtons();
      break;

    case 'RECONNECTED':
      myRoom=msg.roomCode;
      showToast('✅ Riconnesso!','ok');
      break;
    case 'RECONNECT_FAILED':
      clearSession();
      break;

    case 'ROOM_CREATED':
      myRoom=msg.roomCode; isCreator=true;
      document.getElementById('disp-room-code').textContent=msg.roomCode;
      document.getElementById('settings-block').style.display='block';
      updateSettings(msg.settings||{});
      updateWaitingList(msg.players);
      showScreen('screen-waiting');
      saveSession(myName,myRoom);
      break;

    case 'ROOM_JOINED':
      myRoom=msg.roomCode; isCreator=false;
      document.getElementById('disp-room-code').textContent=msg.roomCode;
      document.getElementById('settings-block').style.display='none';
      updateWaitingList(msg.players);
      showScreen('screen-waiting');
      saveSession(myName,myRoom);
      break;

    case 'PLAYER_JOINED':
      updateWaitingList(msg.players);
      sysChat(`${msg.newPlayer} si è unito!`);
      break;

    case 'SETTINGS_UPDATED':
      updateSettings(msg.settings||{});
      break;

    case 'GAME_STARTED': break;

    case 'GAME_STATE':
      applyState(msg.state);
      break;

    case 'MOVE_PLAYED':
      if (msg.playerId!==myId)
        sysChat(`${msg.playerName}: ${msg.words.join(', ')} +${msg.score}pt${msg.scrabboBonus?' 🎉SCARABEO!':''}`);
      addMoveLog(msg.playerName,msg.words,msg.score);
      showScorePopup(msg.score);
      playSound('word');
      break;

    case 'INVALID_MOVE':
      showToast(msg.reason,'err'); recallAll(); playSound('error'); break;

    case 'CHAT':
      addChat(msg.playerName,msg.text,msg.playerId===myId); break;

    case 'TURN_TIMEOUT':
      sysChat('⏱️ Tempo scaduto!'); playSound('tick'); break;

    case 'LOBBIES_LIST':
      renderPublicLobbies(msg.lobbies); break;

    case 'PLAYER_DISCONNECTED':
      sysChat(`⚠️ ${msg.playerName} si è disconnesso`); break;
    case 'PLAYER_RECONNECTED':
      sysChat(`✅ ${msg.playerName} riconnesso!`); playSound('word'); break;

    case 'GAME_OVER':
      fullMoveHistory=gameState.moveHistory||[];
      showGameOver(msg.players);
      clearSession();
      break;

    case 'ERROR': showToast(msg.message,'err'); break;
  }
}

// ────────────────────────────────────────────────
// APPLICA STATO
// ────────────────────────────────────────────────
function applyState(state) {
  const first = gameState.status!=='playing' && state.status==='playing';
  gameState=state;
  if (first) {
    showScreen('screen-game');
    document.getElementById('game-room-label').textContent=myRoom;
    initBoard();
    setMobileTab('board');
  }
  if (state.status==='playing') {
    renderBoard(state.board);
    renderScores(state.players);
    renderRack(state.rack||[]);
    updateTurnUI(state.currentPlayerId,state.currentPlayerName);
    document.getElementById('bag-count').textContent=state.bagRemaining;
    const mine=state.currentPlayerId===myId;
    document.getElementById('btn-pass').disabled=!mine;
    document.getElementById('btn-exchange-open').disabled=!mine;
    document.getElementById('btn-confirm').disabled=pending.length===0||!mine;
    if (state.chatMessages) syncChat(state.chatMessages);
    if (state.moveHistory)  { fullMoveHistory=state.moveHistory; syncMoveLog(state.moveHistory); }
    updatePreview();
  }
  GameApi.setState({gameState:state,myId});
}

// ────────────────────────────────────────────────
// TABELLONE + RACK (identici v3)
// ────────────────────────────────────────────────
function initBoard(){
  const el=document.getElementById('game-board'); el.innerHTML='';
  for(let r=0;r<15;r++) for(let c=0;c<15;c++){
    const cell=document.createElement('div');
    cell.className='cell'; cell.dataset.r=r; cell.dataset.c=c; cell.dataset.t=BONUS_LAYOUT[r][c];
    const lbl=document.createElement('span'); lbl.className='cell-lbl';
    lbl.textContent=CELL_LABELS[BONUS_LAYOUT[r][c]]||''; cell.appendChild(lbl);
    cell.addEventListener('dragover',onDragOver); cell.addEventListener('dragleave',onDragLeave);
    cell.addEventListener('drop',onDrop); cell.addEventListener('click',onCellClick);
    el.appendChild(cell);
  }
}
function renderBoard(board){
  if(!board?.length) return;
  document.querySelectorAll('.cell').forEach(cell=>{
    const r=+cell.dataset.r, c=+cell.dataset.c, d=board[r]?.[c]; if(!d) return;
    const isPend=pending.some(p=>p.row===r&&p.col===c);
    if(d.letter&&!isPend){
      if(!cell.classList.contains('has-tile')){ cell.classList.add('has-tile'); cell.innerHTML=makeTileHTML(d.letter,d.value,false); }
    } else if(isPend){
      const pt=pending.find(p=>p.row===r&&p.col===c);
      cell.classList.add('has-tile'); cell.innerHTML=makeTileHTML(pt.displayLetter||pt.letter,pt.value,true,true);
      cell.querySelector('.board-tile')?.addEventListener('click',e=>{e.stopPropagation();recallTile(r,c);});
    } else if(!d.letter){
      if(cell.classList.contains('has-tile')){
        cell.classList.remove('has-tile');
        cell.innerHTML=`<span class="cell-lbl">${CELL_LABELS[BONUS_LAYOUT[r][c]]||''}</span>`;
      }
    }
  });
  updateKbCursor();
}
function makeTileHTML(letter,value,isNew,isPending=false){
  const cls=isPending?'pending':(isNew?'new':'');
  return `<div class="board-tile ${cls}"><span class="t-letter">${letter==='?'?'★':letter}</span><span class="t-value">${value??0}</span></div>`;
}
function renderRack(rack){
  const el=document.getElementById('rack-tiles'); el.innerHTML='';
  rack.forEach((tile,i)=>{
    if(pending.some(p=>p.rackIdx===i)) return;
    const t=document.createElement('div');
    t.className=`rtile${tile.letter==='?'?' jolly':''}`; t.dataset.idx=i; t.draggable=true;
    t.innerHTML=`<span class="kb-idx">${i+1}</span><span class="t-letter">${tile.letter==='?'?'★':tile.letter}</span><span class="t-value">${tile.value}</span>`;
    if(selIdx===i) t.classList.add('sel');
    t.addEventListener('click',()=>onRackClick(i,tile));
    t.addEventListener('dragstart',e=>onDragStart(e,i,tile));
    t.addEventListener('dragend',()=>{t.classList.remove('drag');highlightValidCells(false);});
    el.appendChild(t);
  });
}

// ── Drag & drop ──
let dragData=null;
function onDragStart(e,idx,tile){ dragData={rackIdx:idx,...tile}; e.dataTransfer.setData('text/plain',JSON.stringify(dragData)); e.currentTarget.classList.add('drag'); selIdx=idx; highlightValidCells(true); }
function onDragOver(e){ if(gameState.currentPlayerId!==myId)return; e.preventDefault(); e.dataTransfer.dropEffect='move'; e.currentTarget.classList.add('drop-over'); }
function onDragLeave(e){ e.currentTarget.classList.remove('drop-over'); }
function onDrop(e){
  e.preventDefault(); e.currentTarget.classList.remove('drop-over'); highlightValidCells(false);
  if(gameState.currentPlayerId!==myId) return;
  const r=+e.currentTarget.dataset.r, c=+e.currentTarget.dataset.c;
  try{ const d=JSON.parse(e.dataTransfer.getData('text/plain')); placeTile(d.rackIdx,d.letter,d.value,r,c,d.letter==='?'); }catch(x){console.error(x);}
}
function onRackClick(idx,tile){
  if(gameState.currentPlayerId!==myId) return;
  if(selIdx===idx){ selIdx=null; document.querySelectorAll('.rtile').forEach(el=>el.classList.remove('sel')); highlightValidCells(false); }
  else{ selIdx=idx; document.querySelectorAll('.rtile').forEach(el=>el.classList.remove('sel')); document.querySelector(`.rtile[data-idx="${idx}"]`)?.classList.add('sel'); highlightValidCells(true); }
}
function onCellClick(e){
  if(gameState.currentPlayerId!==myId||selIdx===null) return;
  const r=+e.currentTarget.dataset.r, c=+e.currentTarget.dataset.c;
  if(gameState.board[r]?.[c]?.letter||pending.some(p=>p.row===r&&p.col===c)) return;
  const tile=(gameState.rack||[])[selIdx]; if(!tile) return;
  placeTile(selIdx,tile.letter,tile.value,r,c,tile.letter==='?');
  selIdx=null; document.querySelectorAll('.rtile').forEach(el=>el.classList.remove('sel')); highlightValidCells(false);
}

function highlightValidCells(show){
  document.querySelectorAll('.cell').forEach(cell=>{
    cell.classList.remove('valid-drop'); if(!show) return;
    const r=+cell.dataset.r, c=+cell.dataset.c, board=gameState.board;
    if(board[r]?.[c]?.letter||pending.some(p=>p.row===r&&p.col===c)) return;
    const empty=!board.some(row=>row.some(c=>c.letter));
    if(empty){ if(Math.abs(r-7)<=2&&Math.abs(c-7)<=2) cell.classList.add('valid-drop'); return; }
    const dirs=[[-1,0],[1,0],[0,-1],[0,1]];
    for(const[dr,dc]of dirs){ const nr=r+dr,nc=c+dc; if(nr<0||nr>14||nc<0||nc>14)continue; if(board[nr]?.[nc]?.letter||pending.some(p=>p.row===nr&&p.col===nc)){ cell.classList.add('valid-drop');break; } }
  });
}

function placeTile(rackIdx,letter,value,row,col,isJolly){
  if(isJolly){ showJollyModal(chosen=>{ pending.push({rackIdx,letter:chosen,displayLetter:chosen,value:0,row,col,isJolly:true}); refreshPending(); }); return; }
  pending.push({rackIdx,letter,value,row,col,isJolly:false});
  refreshPending(); playSound('place'); advanceKbCursor(row,col);
}
function refreshPending(){ renderBoard(gameState.board); renderRack(gameState.rack||[]); const mine=gameState.currentPlayerId===myId; document.getElementById('btn-confirm').disabled=pending.length===0||!mine; updatePreview(); }
function recallTile(row,col){ pending=pending.filter(p=>!(p.row===row&&p.col===col)); refreshPending(); }
function recallAll(){ pending=[]; refreshPending(); highlightValidCells(false); }
function updatePreview(){
  const el=document.getElementById('score-preview'); if(pending.length===0){el.classList.add('hidden');return;}
  let pts=0,wm=1; pending.forEach(t=>{ const ct=BONUS_LAYOUT[t.row][t.col]; pts+=(t.value||0)*(LM[ct]||1); wm*=(WM[ct]||1); }); pts*=wm; if(pending.length===7)pts+=50;
  document.getElementById('preview-pts').textContent=pts; el.classList.remove('hidden');
}
function confirmMove(){
  if(pending.length===0||gameState.currentPlayerId!==myId) return;
  send('PLACE_TILES',{tiles:pending.map(t=>({letter:t.letter,value:t.value,row:t.row,col:t.col,isJolly:t.isJolly||false}))});
  pending=[]; document.getElementById('btn-confirm').disabled=true; document.getElementById('score-preview').classList.add('hidden'); highlightValidCells(false);
}

// ── Timer ──
function tickTimer(){
  const ts=gameState.turnStartTime; if(!ts) return;
  const dur=(gameState.turnDuration||60)*1000, remaining=Math.max(0,dur-(Date.now()-ts)), secs=Math.ceil(remaining/1000);
  document.getElementById('timer-text').textContent=secs;
  const circle=document.getElementById('timer-circle'); if(circle) circle.style.strokeDashoffset=113*(1-remaining/dur);
  document.querySelector('.timer-wrap')?.classList.toggle('timer-urgent',secs<=10);
}
function updateTurnUI(cpId,cpName){
  document.getElementById('turn-name').textContent=cpName||'—';
  const mine=cpId===myId;
  const badge=document.getElementById('topbar-turn');
  badge.textContent=mine?'🟢 Tuo turno!':`⏳ ${cpName}…`; badge.className='turn-badge'+(mine?' mine':'');
  if(mine) showToast('È il tuo turno!','ok');
  document.querySelectorAll('.score-item').forEach(el=>el.classList.toggle('active-turn',el.dataset.pid===cpId));
}
function renderScores(players){
  const el=document.getElementById('score-list'); if(!el||!players) return; el.innerHTML='';
  players.forEach((p,i)=>{ const item=document.createElement('div'); item.className='score-item'+(p.id===gameState.currentPlayerId?' active-turn':'')+(p.disconnected?' disconnected':''); item.dataset.pid=p.id; item.innerHTML=`<div class="pdot pdot-${i}"></div><span class="score-name">${esc(p.name)}${p.id===myId?' (tu)':''}${p.disconnected?' 🔌':''}</span><span class="score-pts">${p.score}</span>`; el.appendChild(item); });
}

// ── Keyboard nav ──
function updateKbCursor(){ document.querySelectorAll('.cell.kb-cursor').forEach(c=>c.classList.remove('kb-cursor')); if(!kbActive)return; document.querySelector(`.cell[data-r="${kbRow}"][data-c="${kbCol}"]`)?.classList.add('kb-cursor'); }
function advanceKbCursor(fr,fc){ kbRow=fr;kbCol=fc; if(kbDir==='h'&&kbCol<14)kbCol++; else if(kbDir==='v'&&kbRow<14)kbRow++; kbActive=true; updateKbCursor(); }
function handleKeyboard(e){
  const tag=document.activeElement?.tagName; if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA') return;
  if(gameState.status!=='playing') return;
  const mine=gameState.currentPlayerId===myId;
  switch(e.key){
    case 'Enter': if(pending.length>0&&mine){e.preventDefault();confirmMove();}break;
    case 'Escape': e.preventDefault();recallAll();kbActive=false;updateKbCursor();break;
    case ' ': e.preventDefault();shuffleRack();break;
    case 'Backspace': if(pending.length>0){e.preventDefault();const last=pending[pending.length-1];recallTile(last.row,last.col);kbRow=last.row;kbCol=last.col;kbActive=true;updateKbCursor();}break;
    case 'p':case 'P': if(mine){e.preventDefault();send('PASS_TURN');}break;
    case 'ArrowRight':e.preventDefault();kbActive=true;if(kbCol<14)kbCol++;kbDir='h';updateKbCursor();break;
    case 'ArrowLeft': e.preventDefault();kbActive=true;if(kbCol>0)kbCol--;kbDir='h';updateKbCursor();break;
    case 'ArrowDown': e.preventDefault();kbActive=true;if(kbRow<14)kbRow++;kbDir='v';updateKbCursor();break;
    case 'ArrowUp':   e.preventDefault();kbActive=true;if(kbRow>0)kbRow--;kbDir='v';updateKbCursor();break;
    default:
      if(/^[1-7]$/.test(e.key)&&mine){ const idx=+e.key-1; const rack=gameState.rack||[]; if(rack[idx]&&!pending.some(p=>p.rackIdx===idx)){e.preventDefault();onRackClick(idx,rack[idx]);} break; }
      if(/^[a-zA-Z]$/.test(e.key)&&mine&&kbActive){ const letter=e.key.toUpperCase(); const rack=gameState.rack||[]; const rIdx=rack.findIndex((t,i)=>t.letter===letter&&!pending.some(p=>p.rackIdx===i)); if(rIdx!==-1&&!gameState.board[kbRow]?.[kbCol]?.letter&&!pending.some(p=>p.row===kbRow&&p.col===kbCol)){e.preventDefault();placeTile(rIdx,rack[rIdx].letter,rack[rIdx].value,kbRow,kbCol,false);} }
  }
}

// ── Chat ──
function syncChat(msgs){ const el=document.getElementById('chat-msgs'); if(!el)return; el.innerHTML=''; msgs.forEach(m=>appendChat(m.type==='system'?null:m.playerName,m.text,m.type==='system')); }
function addChat(name,text){ appendChat(name,text,false); }
function sysChat(text){ appendChat(null,text,true); }
function appendChat(name,text,isSys){ const el=document.getElementById('chat-msgs'); if(!el)return; const div=document.createElement('div'); div.className='chat-msg'+(isSys?' sys':''); div.innerHTML=isSys?esc(text):`<span class="chat-author">${esc(name)}:</span>${esc(text)}`; el.appendChild(div); el.scrollTop=el.scrollHeight; }

// ── Move log ──
function syncMoveLog(history){ const el=document.getElementById('move-log'); if(!el)return; el.innerHTML=''; [...history].reverse().forEach(m=>appendMoveEntry(m.playerName,m.words,m.score)); }
function addMoveLog(name,words,score){ appendMoveEntry(name,words,score); }
function appendMoveEntry(name,words,score){ const el=document.getElementById('move-log'); if(!el)return; const d=document.createElement('div'); d.className='move-entry'; d.innerHTML=`<div class="move-word">${esc(words.join(', '))}</div><div class="move-meta">${esc(name)} <span class="move-pts">+${score}</span></div>`; el.insertBefore(d,el.firstChild); while(el.children.length>30)el.removeChild(el.lastChild); }

// ── Suoni ──
function playSound(type){ if(!soundOn)return; try{ if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)(); const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(); osc.connect(gain);gain.connect(audioCtx.destination); osc.frequency.value={place:440,word:660,error:220,tick:330}[type]||440; osc.type='sine'; gain.gain.setValueAtTime(.15,audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.2); osc.start();osc.stop(audioCtx.currentTime+.2); }catch(e){} }

// ── Toast / popup ──
let toastTimer=null;
function showToast(text,type='info'){ const el=document.getElementById('toast'); el.textContent=text; el.className=`toast ${type}`; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className='toast hidden',3200); }
function showScorePopup(score){ const el=document.getElementById('score-popup'); el.textContent=`+${score}`; el.className='score-popup'; el.style.top='45%';el.style.left='50%';el.style.transform='translateX(-50%)'; setTimeout(()=>el.className='score-popup hidden',950); }

// ── Jolly ──
function showJollyModal(cb){ const modal=document.getElementById('modal-jolly'), grid=document.getElementById('jolly-grid'); modal.classList.remove('hidden'); grid.innerHTML=''; 'ABCDEFGHIJLMNOPQRSTUVZ'.split('').forEach(l=>{ const btn=document.createElement('button'); btn.className='jolly-btn';btn.textContent=l; btn.addEventListener('click',()=>{modal.classList.add('hidden');cb(l);}); grid.appendChild(btn); }); document.getElementById('btn-jolly-cancel').onclick=()=>modal.classList.add('hidden'); }

// ── Scambio ──
function openExchangeModal(){ const rack=gameState.rack||[]; const el=document.getElementById('exchange-rack'); exSel.clear();el.innerHTML=''; rack.forEach((tile,i)=>{ const t=document.createElement('div'); t.className='ex-tile';t.dataset.i=i; t.innerHTML=`<span class="t-letter">${tile.letter==='?'?'★':tile.letter}</span><span class="t-value">${tile.value}</span>`; t.addEventListener('click',()=>{ if(exSel.has(i)){exSel.delete(i);t.classList.remove('ex-sel');}else{exSel.add(i);t.classList.add('ex-sel');} document.getElementById('btn-exchange-confirm').disabled=exSel.size===0; }); el.appendChild(t); }); document.getElementById('btn-exchange-confirm').disabled=true; document.getElementById('modal-exchange').classList.remove('hidden'); }
function shuffleRack(){ const rack=gameState.rack||[]; if(rack.length<2)return; for(let i=rack.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rack[i],rack[j]]=[rack[j],rack[i]];} renderRack(rack);playSound('place'); }

// ────────────────────────────────────────────────
// LOBBY PUBBLICA — fetch e rendering
// ────────────────────────────────────────────────
async function fetchPublicLobbies(){
  try{
    const data=await apiCall('GET','/api/lobbies');
    renderPublicLobbies(data.lobbies||[]);
  }catch{ renderPublicLobbies([]); }
}

function renderPublicLobbies(lobbies){
  const el=document.getElementById('pub-lobby-list'); if(!el) return;
  if(!lobbies||lobbies.length===0){ el.innerHTML='<p class="empty-state">Nessuna lobby pubblica in questo momento.</p>'; return; }
  el.innerHTML='';
  lobbies.forEach(lobby=>{
    const item=document.createElement('div'); item.className='pub-lobby-item';
    const ago=lobby.createdAgo<60?`${lobby.createdAgo}s fa`:`${Math.round(lobby.createdAgo/60)}m fa`;
    const dots=lobby.players.map((_,i)=>`<div class="pub-player-dot pub-player-dot-${i}"></div>`).join('');
    item.innerHTML=`
      <div class="pub-lobby-info">
        <div class="pub-lobby-name">${esc(lobby.roomName)}</div>
        <div class="pub-lobby-meta">
          <span>${lobby.players.length}/${lobby.maxPlayers} giocatori</span> ·
          <span>⏱ ${lobby.turnDuration}s</span> ·
          <span>creata ${ago}</span>
        </div>
        <div class="pub-players-avatars" style="margin-top:.3rem">${dots}</div>
      </div>
      <div style="text-align:right">
        <div class="pub-lobby-code">${lobby.roomCode}</div>
        <button class="btn-join-pub" data-code="${lobby.roomCode}" style="margin-top:.4rem">Entra →</button>
      </div>`;
    item.querySelector('.btn-join-pub').addEventListener('click',()=>{
      document.getElementById('modal-join').classList.remove('hidden');
      document.getElementById('join-code').value=lobby.roomCode;
    });
    el.appendChild(item);
  });
}

// ────────────────────────────────────────────────
// STORICO PARTITE — fetch e rendering
// ────────────────────────────────────────────────
async function fetchHistory(){
  if(!myUsername){ document.getElementById('history-list').innerHTML='<p class="empty-state">Accedi per vedere lo storico.</p>'; return; }
  try{
    const data=await apiCall('GET',`/api/history/${myUsername}`);
    renderHistory(data.history||[]);
  }catch{ document.getElementById('history-list').innerHTML='<p class="empty-state">Impossibile caricare lo storico.</p>'; }
}

function renderHistory(history){
  const el=document.getElementById('history-list'); if(!el) return;
  if(!history||history.length===0){ el.innerHTML='<p class="empty-state">Nessuna partita trovata.</p>'; return; }
  el.innerHTML='';
  history.forEach(match=>{
    const me=match.players.find(p=>p.username.toLowerCase()===myUsername.toLowerCase());
    const won=match.winner.toLowerCase()===myUsername.toLowerCase();
    const date=new Date(match.endedAt).toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'});
    const dur=match.durationSeconds>=60?`${Math.round(match.durationSeconds/60)}m`:`${match.durationSeconds}s`;
    const playersHtml=match.players.map(p=>`<span class="history-player-chip${p.username.toLowerCase()===myUsername.toLowerCase()?' me':''}">${esc(p.username)} ${p.score}pt</span>`).join('');
    const item=document.createElement('div'); item.className='history-item';
    item.innerHTML=`
      <div class="history-header">
        <span class="history-date">${date} · ${dur}</span>
        <span class="history-result ${won?'win':'loss'}">${won?'🏆 Vittoria':'Sconfitta'}</span>
      </div>
      <div class="history-players">${playersHtml}</div>
      ${me?.bestWord?`<div class="history-words">Parola migliore: <strong>${esc(me.bestWord.word)}</strong> (${me.bestWord.score}pt)</div>`:''}`;
    el.appendChild(item);
  });
}

// ────────────────────────────────────────────────
// LEADERBOARD
// ────────────────────────────────────────────────
async function fetchLeaderboard(){
  try{
    const data=await apiCall('GET','/api/leaderboard');
    renderLeaderboard(data.leaderboard||[]);
  }catch{ document.getElementById('leaderboard-list').innerHTML='<p class="empty-state">Impossibile caricare la classifica.</p>'; }
}

function renderLeaderboard(board){
  const el=document.getElementById('leaderboard-list'); if(!el) return;
  if(!board||board.length===0){ el.innerHTML='<p class="empty-state">Nessun dato disponibile.</p>'; return; }
  el.innerHTML='';
  const medals=['🥇','🥈','🥉'], rankCls=['r1','r2','r3'];
  board.forEach((entry,i)=>{
    const item=document.createElement('div');
    item.className='lb-item'+(entry.username.toLowerCase()===(myUsername||'').toLowerCase()?' me':'');
    item.innerHTML=`
      <div class="lb-rank ${rankCls[i]||''}">${medals[i]||(i+1)}</div>
      <div class="lb-name">${esc(entry.username)}</div>
      <div class="lb-stats">
        <div><span class="lb-wins">${entry.gamesWon}</span> vittorie</div>
        <div>${entry.gamesPlayed} partite · ~${entry.avgScore}pt</div>
        ${entry.bestWord?`<div>🏅 ${esc(entry.bestWord)}</div>`:''}
      </div>`;
    el.appendChild(item);
  });
}

// ────────────────────────────────────────────────
// SETTINGS + WAITING LIST
// ────────────────────────────────────────────────
function updateSettings(s){
  if(s.turnDuration){ const sel=document.getElementById('set-timer'); if(sel)sel.value=String(s.turnDuration); }
  if(s.maxPlayers){   const sel=document.getElementById('set-players'); if(sel)sel.value=String(s.maxPlayers); }
}
function sendSettings(){ if(!isCreator)return; send('CHANGE_SETTINGS',{settings:{turnDuration:+document.getElementById('set-timer').value,maxPlayers:+document.getElementById('set-players').value}}); }
function updateWaitingList(players){
  const el=document.getElementById('waiting-players'), btn=document.getElementById('btn-start'), cnt=document.getElementById('player-count');
  if(!el)return; el.innerHTML='';
  players.forEach(p=>{ const item=document.createElement('div');item.className='player-item';item.innerHTML=`<div class="player-dot"></div>${esc(p.name)}`;el.appendChild(item); });
  if(cnt)cnt.textContent=`(${players.length}/2+)`;
  if(btn)btn.disabled=players.length<2;
}

// ── Fine partita ──
function showGameOver(players){
  const ranking=[...players].sort((a,b)=>b.score-a.score);
  const rankEl=document.getElementById('final-ranking'), statEl=document.getElementById('final-stats'), histEl=document.getElementById('full-history');
  rankEl.innerHTML=''; statEl.innerHTML=''; histEl.innerHTML='';
  const medals=['🥇','🥈','🥉','4°'], cls=['r1','r2','r3',''];
  ranking.forEach((p,i)=>{ const item=document.createElement('div');item.className='rank-item'+(i===0?' winner':'');item.innerHTML=`<div class="rank-badge ${cls[i]||''}">${medals[i]||''}</div><div><div class="rank-name">${esc(p.name)}${p.id===myId?' (tu)':''}</div><div class="rank-sub">${p.totalWords||0} parole${p.bestWord?` · ${p.bestWord.word} (${p.bestWord.score}pt)`:''}</div></div><div class="rank-score">${p.score}pt</div>`; rankEl.appendChild(item); });
  const best=ranking.reduce((a,b)=>(a.bestWord?.score||0)>(b.bestWord?.score||0)?a:b,ranking[0]);
  if(best?.bestWord) addStatChip(`Parola migliore: <strong>${best.bestWord.word}</strong> — ${esc(best.name)}`,statEl);
  fullMoveHistory.forEach(m=>{ const d=document.createElement('div');d.className='hist-entry';d.innerHTML=`T${m.turn} <span class="hist-word">${esc(m.words.join(', '))}</span> <span class="hist-pts">+${m.score}</span> — ${esc(m.playerName)}`; histEl.appendChild(d); });
  showScreen('screen-gameover');
}
function addStatChip(html,container){ const chip=document.createElement('div');chip.className='stat-chip';chip.innerHTML=html;container.appendChild(chip); }

// ── Mobile tabs ──
function setMobileTab(tab){ document.querySelectorAll('.mtab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab)); document.getElementById('panel-board').classList.toggle('tab-active',tab==='board'); document.getElementById('panel-scores').classList.toggle('tab-active',tab==='scores'||tab==='chat'); document.getElementById('panel-history').classList.toggle('tab-active',tab==='history'); }

// ──Abilita bottoni lobby quando il nome è confermato ──
function enableLobbyButtons() {
  document.getElementById('btn-create-open')?.removeAttribute('disabled');
  document.getElementById('btn-join-open')?.removeAttribute('disabled');
  document.getElementById('btn-create-remove')?.removeAttribute('disabled');
}

// ── Lobby tabs ──
function setLobbyTab(tab){
  document.querySelectorAll('.lobby-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.ltab').forEach(el=>el.classList.remove('active'));
  document.getElementById(`ltab-${tab}`)?.classList.add('active');
  if(tab==='public')  fetchPublicLobbies();
  if(tab==='history') fetchHistory();
  if(tab==='leaderboard') fetchLeaderboard();
}

// ── Utils ──
function showScreen(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); document.getElementById(id)?.classList.add('active'); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // ── 1. Prova auto-login ──
  const savedUser = await tryAutoLogin();
  if (savedUser) {
    enterLobby(savedUser.username);
  } else {
    showScreen('screen-auth');
  }

  // ── 2. Collega WS ──
  connectWs();
  document.addEventListener('keydown', handleKeyboard);

  // ── Auth form ──
  document.querySelectorAll('.atab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.atab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`auth-${tab.dataset.tab}`)?.classList.add('active');
    });
  });

  document.getElementById('btn-login').addEventListener('click', async ()=>{
    const u=document.getElementById('li-user').value.trim();
    const p=document.getElementById('li-pass').value;
    const errEl=document.getElementById('li-err');
    errEl.classList.add('hidden');
    if(!u||!p){ errEl.textContent='Compila tutti i campi'; errEl.classList.remove('hidden'); return; }
    const r=await doLogin(u,p);
    if(!r.success){ errEl.textContent=r.reason; errEl.classList.remove('hidden'); return; }
    enterLobby(r.user.username);
  });

  document.getElementById('btn-register').addEventListener('click', async ()=>{
    const u=document.getElementById('reg-user').value.trim();
    const p=document.getElementById('reg-pass').value;
    const p2=document.getElementById('reg-pass2').value;
    const errEl=document.getElementById('reg-err');
    errEl.classList.add('hidden');
    if(!u||!p||!p2){ errEl.textContent='Compila tutti i campi'; errEl.classList.remove('hidden'); return; }
    if(p!==p2){ errEl.textContent='Le password non coincidono'; errEl.classList.remove('hidden'); return; }
    const r=await doRegister(u,p);
    if(!r.success){ errEl.textContent=r.reason; errEl.classList.remove('hidden'); return; }
    enterLobby(r.user.username);
  });

  document.getElementById('btn-guest').addEventListener('click', ()=>{
    const name=document.getElementById('li-user').value.trim()||'Ospite';
    myName=name; enterLobby(name, true);
  });

  // ── Enter key per form auth ──
  ['li-user','li-pass'].forEach(id=>{ document.getElementById(id).addEventListener('keydown',e=>{ if(e.key==='Enter')document.getElementById('btn-login').click(); }); });
  ['reg-user','reg-pass','reg-pass2'].forEach(id=>{ document.getElementById(id).addEventListener('keydown',e=>{ if(e.key==='Enter')document.getElementById('btn-register').click(); }); });

  // ── Lobby ──
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  document.querySelectorAll('.lobby-tab').forEach(tab=>{
    tab.addEventListener('click',()=>setLobbyTab(tab.dataset.tab));
  });

  // Modal: Crea stanza
  document.getElementById('btn-create-open').addEventListener('click',()=>{
    document.getElementById('modal-create').classList.remove('hidden');
  });
  document.getElementById('btn-create-cancel').addEventListener('click',()=>{
    document.getElementById('modal-create').classList.add('hidden');
  });
  document.getElementById('btn-create-confirm').addEventListener('click',()=>{
    const roomName=document.getElementById('create-name').value.trim();
    const isPublic=document.getElementById('create-public').checked;
    send('CREATE_ROOM',{roomName,isPublic});
    // Invia anche settings
    send('CHANGE_SETTINGS',{settings:{
      turnDuration:+document.getElementById('create-timer').value,
      maxPlayers:+document.getElementById('create-maxplayers').value
    }});
    document.getElementById('modal-create').classList.add('hidden');
  });

  // Modal: Entra con codice
  document.getElementById('btn-join-open').addEventListener('click',()=>document.getElementById('modal-join').classList.remove('hidden'));
  document.getElementById('btn-join-cancel').addEventListener('click',()=>document.getElementById('modal-join').classList.add('hidden'));
  document.getElementById('btn-join-confirm').addEventListener('click',()=>{
    const code=document.getElementById('join-code').value.trim().toUpperCase();
    if(code.length!==4){showToast('Codice a 4 lettere!','err');return;}
    send('JOIN_ROOM',{roomCode:code});
    document.getElementById('modal-join').classList.add('hidden');
  });
  document.getElementById('join-code').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('btn-join-confirm').click();});

  document.getElementById('btn-refresh-lobbies').addEventListener('click',fetchPublicLobbies);

  // ── Attesa ──
  document.getElementById('btn-start').addEventListener('click',()=>send('START_GAME'));
  document.getElementById('btn-leave-waiting').addEventListener('click',()=>{ myRoom='';isCreator=false; showScreen('screen-lobby'); });
  document.getElementById('set-timer').addEventListener('change',sendSettings);
  document.getElementById('set-players').addEventListener('change',sendSettings);

  // ── Gioco ──
  document.getElementById('btn-confirm').addEventListener('click',confirmMove);
  document.getElementById('btn-recall').addEventListener('click',recallAll);
  document.getElementById('btn-shuffle').addEventListener('click',shuffleRack);
  document.getElementById('btn-pass').addEventListener('click',()=>send('PASS_TURN'));
  document.getElementById('btn-exchange-open').addEventListener('click',openExchangeModal);
  document.getElementById('btn-exchange-confirm').addEventListener('click',()=>{ if(exSel.size===0)return; send('EXCHANGE_TILES',{indices:[...exSel]}); document.getElementById('modal-exchange').classList.add('hidden'); showToast('Tessere scambiate!','ok'); });
  document.getElementById('btn-exchange-cancel').addEventListener('click',()=>document.getElementById('modal-exchange').classList.add('hidden'));
  document.getElementById('btn-sound').addEventListener('click',()=>{ soundOn=!soundOn; document.getElementById('btn-sound').textContent=soundOn?'🔊':'🔇'; });
  document.getElementById('btn-help').addEventListener('click',()=>document.getElementById('overlay-help').classList.remove('hidden'));
  document.getElementById('btn-help-close').addEventListener('click',()=>document.getElementById('overlay-help').classList.add('hidden'));
  document.getElementById('overlay-help').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.add('hidden');});

  const doChat=()=>{ const inp=document.getElementById('chat-inp'); const txt=inp.value.trim();if(!txt)return; send('CHAT',{text:txt});inp.value=''; };
  document.getElementById('btn-chat').addEventListener('click',doChat);
  document.getElementById('chat-inp').addEventListener('keydown',e=>{if(e.key==='Enter')doChat();});

  document.querySelectorAll('.mtab').forEach(btn=>btn.addEventListener('click',()=>setMobileTab(btn.dataset.tab)));

  document.getElementById('btn-new-game').addEventListener('click',()=>{
    pending=[];selIdx=null;kbActive=false;
    gameState={status:'waiting',board:[],players:[],rack:[]};
    showScreen('screen-lobby');
    setLobbyTab('home');
    fetchPublicLobbies();
  });
});

function enterLobby(displayName, isGuest=false) {
  myName=displayName;
  nameConfirmed=false; // NUOVO: attendi conferma dal server
  // Disabilita bottoni lobby finché il nome non sia confermato
  document.getElementById('btn-create-open')?.setAttribute('disabled', 'disabled');
  document.getElementById('btn-join-open')?.setAttribute('disabled', 'disabled');
  // Aggiorna UI profilo
  document.getElementById('user-display-name').textContent=displayName;
  document.getElementById('user-avatar').textContent=displayName[0]?.toUpperCase()||'?';
  // Su ospiti mostriamo comunque il nome
  if(!isGuest) {
    // Collega l'account alla sessione WS (potrebbe non essere ancora aperta)
    if(ws?.readyState===WebSocket.OPEN && myToken) send('AUTH_LINK',{token:myToken});
    else setTimeout(()=>{ if(myToken) send('AUTH_LINK',{token:myToken}); }, 500);
  } else {
    // Per ospiti: imposta il nome via WS quando disponibile
    if(ws?.readyState===WebSocket.OPEN) send('SET_NAME',{name:displayName});
    else setTimeout(()=>send('SET_NAME',{name:displayName}),100);
  }
  showScreen('screen-lobby');
  setLobbyTab('home');
}
