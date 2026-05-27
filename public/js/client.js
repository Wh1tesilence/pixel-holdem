// Pixel Hold'em — Client-side logic

// ---- State ----
let socket = null;
let playerName = '';
let roomId = '';
let isHost = false;
let gameState = null;

// ---- DOM helpers ----
const $ = (sel) => document.querySelector(sel);

// ---- Init ----
function init() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected:', socket.id);
    const saved = getSavedSession();
    if (saved) {
      socket.emit('rejoin_room', saved);
    }
  });

  socket.on('room_created', onRoomCreated);
  socket.on('room_joined', onRoomJoined);
  socket.on('room_update', onRoomUpdate);
  socket.on('game_state', onGameState);
  socket.on('game_over', onGameOver);
  socket.on('error', onError);
  socket.on('disconnect', () => {
    showToast('Connection lost. Reconnecting...');
  });

  // Button handlers
  $('#btn-create').addEventListener('click', createRoom);
  $('#btn-join').addEventListener('click', joinRoom);
  $('#btn-start').addEventListener('click', startGame);
  $('#btn-leave').addEventListener('click', leaveRoom);
  $('#btn-next-hand').addEventListener('click', nextHand);

  // Enter key in inputs
  $('#room-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('#player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoom();
  });
}

// ---- Session persistence ----
function saveSession() {
  sessionStorage.setItem('poker_session', JSON.stringify({ roomId, playerName }));
}

function getSavedSession() {
  const data = sessionStorage.getItem('poker_session');
  return data ? JSON.parse(data) : null;
}

function clearSession() {
  sessionStorage.removeItem('poker_session');
}

// ---- Element references (cached after DOM ready) ----
function el(id) { return document.getElementById(id); }

// ---- Lobby handlers ----
function getName() {
  return el('player-name').value.trim();
}

function createRoom() {
  const name = getName();
  if (!name) { showToast('Enter your name first!'); return; }
  playerName = name;
  socket.emit('create_room', { playerName: name });
}

function joinRoom() {
  const name = getName();
  const code = el('room-code-input').value.trim();
  if (!name) { showToast('Enter your name first!'); return; }
  if (!code) { showToast('Enter a room code!'); return; }
  playerName = name;
  roomId = code.toUpperCase();
  socket.emit('join_room', { roomId: roomId, playerName: name });
}

function startGame() {
  if (!isHost) return;
  socket.emit('start_game');
}

function leaveRoom() {
  socket.emit('leave_room');
  clearSession();
  resetToLobby();
}

function nextHand() {
  el('result-overlay').style.display = 'none';
}

function resetToLobby() {
  el('lobby-view').classList.add('active');
  el('game-view').classList.remove('active');
  el('lobby-join').style.display = 'block';
  el('lobby-room').style.display = 'none';
  el('btn-start').style.display = 'none';
  el('player-name').value = playerName;
  isHost = false;
  roomId = '';
  gameState = null;
  el('result-overlay').style.display = 'none';
}

// ---- Socket event handlers ----
function onRoomCreated(data) {
  roomId = data.roomId;
  playerName = data.playerName;
  isHost = true;
  saveSession();

  el('lobby-join').style.display = 'none';
  el('lobby-room').style.display = 'block';
  el('room-code-text').textContent = roomId;
  el('btn-start').style.display = 'block';
}

function onRoomJoined(data) {
  roomId = data.roomId;
  playerName = data.playerName;
  isHost = false;
  saveSession();

  el('lobby-join').style.display = 'none';
  el('lobby-room').style.display = 'block';
  el('room-code-text').textContent = roomId;
  el('btn-start').style.display = 'none';

  renderPlayerList(data.players);
}

function onRoomUpdate(data) {
  renderPlayerList(data.players);
  if (isHost) {
    el('btn-start').style.display = 'block';
  }
}

function onGameState(state) {
  gameState = state;

  if (state.phase === 'hand_end') {
    renderGame(state);
    showResultOverlay(state.result);
    return;
  }

  if (el('lobby-view').classList.contains('active')) {
    el('lobby-view').classList.remove('active');
    el('game-view').classList.add('active');
  }

  renderGame(state);
}

function onGameOver(data) {
  el('result-overlay').style.display = 'flex';
  el('result-winner').textContent = data.winner + ' WINS!';
  el('result-hand').textContent = 'GAME OVER';
  el('result-pot').textContent = '';
  el('btn-next-hand').textContent = 'BACK TO LOBBY';
  el('btn-next-hand').onclick = () => {
    el('result-overlay').style.display = 'none';
    resetToLobby();
  };
}

function onError(data) {
  showToast(data.message);
}

// ---- Player list rendering ----
function renderPlayerList(players) {
  const container = el('player-list-container');
  container.innerHTML = players.map(p =>
    `<div class="player-list-item">
      <span class="dot"></span>
      <span>${escapeHtml(p.name)}</span>
    </div>`
  ).join('');
}

// ---- Game rendering ----
function renderGame(state) {
  if (!state) return;

  el('game-phase').textContent = formatPhase(state.phase);
  el('game-pot').textContent = state.pot;
  el('hand-num').textContent = state.handNumber;

  // Community cards
  const ccContainer = el('community-cards');
  const neededCards = 5;
  let ccHTML = '';
  for (let i = 0; i < neededCards; i++) {
    if (i < state.communityCards.length) {
      ccHTML += createCardHTML(state.communityCards[i]);
    } else {
      ccHTML += '<div class="card-placeholder"></div>';
    }
  }
  ccContainer.innerHTML = ccHTML;

  renderPlayerSeats(state);
  renderActionPanel(state);
  el('result-overlay').style.display = 'none';
}

function renderPlayerSeats(state) {
  const table = el('poker-table');
  table.querySelectorAll('.player-seat').forEach(el => el.remove());

  const players = state.players;
  const n = players.length;
  const ourIdx = players.findIndex(p => p.name === playerName);

  for (let i = 0; i < n; i++) {
    const player = players[i];
    const seatOffset = (i - ourIdx + n) % n;
    const seatMap = getSeatMap(n);
    const seatClass = seatMap[seatOffset];

    const isOurTurn = state.currentPlayerIdx === i;
    const isDealer = state.dealerIdx === i;

    const seatEl = document.createElement('div');
    seatEl.className = `player-seat ${seatClass}`;
    if (isOurTurn) seatEl.classList.add('active-turn');
    if (player.folded) seatEl.classList.add('folded');

    seatEl.innerHTML = `
      ${isDealer ? '<div class="dealer-chip">D</div>' : ''}
      <span class="player-name">${escapeHtml(player.name)}</span>
      <span class="player-chips">$${player.chips}</span>
      ${player.totalBetThisHand > 0 ? `<span class="player-bet">BET: ${player.totalBetThisHand}</span>` : ''}
      <div class="hole-cards">
        ${player.holeCards.map(c => c === -1
          ? '<div class="pixel-card face-down"></div>'
          : createCardHTML(c, true)
        ).join('')}
      </div>
    `;

    table.appendChild(seatEl);
  }
}

function getSeatMap(n) {
  const positions = ['seat-0', 'seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5', 'seat-6', 'seat-7', 'seat-8'];
  const maps = {
    2: ['seat-0', 'seat-4'],
    3: ['seat-0', 'seat-2', 'seat-4'],
    4: ['seat-1', 'seat-2', 'seat-5', 'seat-6'],
    5: ['seat-0', 'seat-1', 'seat-3', 'seat-5', 'seat-6'],
    6: ['seat-0', 'seat-1', 'seat-2', 'seat-4', 'seat-5', 'seat-6'],
    7: ['seat-7', 'seat-0', 'seat-1', 'seat-2', 'seat-3', 'seat-5', 'seat-6'],
    8: ['seat-7', 'seat-0', 'seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5', 'seat-6'],
    9: ['seat-7', 'seat-8', 'seat-0', 'seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5', 'seat-6']
  };
  return maps[n] || positions.slice(0, n);
}

function renderActionPanel(state) {
  const panel = el('action-panel');
  const actions = state.availableActions;

  if (!actions || actions.length === 0) {
    if (state.phase === 'waiting') {
      panel.innerHTML = '<div class="info-text">Waiting for game to start...</div>';
    } else if (state.phase === 'showdown' || state.phase === 'hand_end') {
      panel.innerHTML = '<div class="info-text">Showdown! Determining winner...</div>';
    } else {
      const currentPlayer = state.players ? state.players[state.currentPlayerIdx] : null;
      const name = currentPlayer ? currentPlayer.name : '...';
      panel.innerHTML = `<div class="info-text">Waiting for ${escapeHtml(name)} to act...</div>`;
    }
    return;
  }

  let html = '<div class="action-buttons">';

  if (actions.includes('fold')) {
    html += '<button class="pixel-btn danger btn-action" data-action="fold">FOLD</button>';
  }

  if (actions.includes('check')) {
    html += '<button class="pixel-btn btn-action" data-action="check">CHECK</button>';
  }

  if (actions.includes('call')) {
    html += `<button class="pixel-btn btn-action" data-action="call">CALL (${state.toCall || 0})</button>`;
  }

  if (actions.includes('raise')) {
    const min = state.minRaiseAmount || 20;
    const max = state.maxRaiseAmount || state.minRaiseAmount;
    const def = Math.min(min * 2, max);
    html += `
      <div class="raise-controls">
        <input type="number" class="pixel-input raise-amount" id="raise-amount"
               min="${min}" max="${max}" value="${Math.min(def, max)}" step="1">
        <button class="pixel-btn gold btn-action" data-action="raise">RAISE</button>
      </div>
    `;
  }

  if (actions.includes('all_in')) {
    html += '<button class="pixel-btn danger btn-action" data-action="all_in">ALL IN</button>';
  }

  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll('.btn-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      let amount = 0;

      if (action === 'raise') {
        const input = document.getElementById('raise-amount');
        amount = parseInt(input.value) || 0;
        if (amount <= 0) {
          showToast('Enter a valid raise amount');
          return;
        }
      }

      socket.emit('player_action', { action, amount });
    });
  });
}

// ---- Card rendering ----
function createCardHTML(cardId, small = false) {
  if (cardId === undefined || cardId === null || cardId === -1) {
    return `<div class="pixel-card face-down ${small ? 'small' : ''}"></div>`;
  }

  const rankIdx = cardId % 13;
  const suitIdx = Math.floor(cardId / 13);

  const rankStr = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'][rankIdx];
  const suitStr = ['♠', '♥', '♦', '♣'][suitIdx];
  const colorClass = (suitIdx === 1 || suitIdx === 2) ? 'red' : 'black';
  const sizeClass = small ? 'small' : '';

  return `
    <div class="pixel-card ${colorClass} ${sizeClass}">
      <span class="card-corner top-left">${rankStr}<br>${suitStr}</span>
      <span class="card-center">${suitStr}</span>
      <span class="card-corner bottom-right">${rankStr}<br>${suitStr}</span>
    </div>
  `;
}

// ---- Result overlay ----
function showResultOverlay(result) {
  if (!result) return;

  const awards = result.awards || [];
  const results = result.results || [];

  const byPlayer = {};
  for (const a of awards) {
    if (!byPlayer[a.playerId]) byPlayer[a.playerId] = { name: a.playerId, total: 0, handNames: [] };
    byPlayer[a.playerId].total += a.amount;
    if (a.handName) byPlayer[a.playerId].handNames.push(a.handName);
  }

  const winnerEntries = Object.entries(byPlayer).sort((a, b) => b[1].total - a[1].total);
  if (winnerEntries.length === 0) return;

  const [winnerId, winnerData] = winnerEntries[0];

  let handsHTML = '';
  if (results.length > 0) {
    handsHTML = '<div style="font-size:7px;color:var(--text-dim);margin:8px 0;">';
    for (const r of results) {
      const player = gameState && gameState.players ? gameState.players.find(p => p.id === r.playerId) : null;
      const pname = player ? player.name : r.playerId;
      handsHTML += `<div>${escapeHtml(pname)}: ${r.handName || 'Folded'}</div>`;
    }
    handsHTML += '</div>';
  }

  el('result-winner').textContent = winnerData.name;
  el('result-hand').textContent = winnerData.handNames.join(' / ') || '';
  el('result-pot').innerHTML = `WINS $${winnerData.total}${handsHTML}`;
  el('btn-next-hand').textContent = 'NEXT HAND';
  el('btn-next-hand').onclick = nextHand;

  el('result-overlay').style.display = 'flex';
}

// ---- Helpers ----
function formatPhase(phase) {
  const map = {
    'waiting': 'WAITING',
    'pre_flop': 'PRE-FLOP',
    'flop': 'FLOP',
    'turn': 'TURN',
    'river': 'RIVER',
    'showdown': 'SHOWDOWN',
    'hand_end': 'HAND END'
  };
  return map[phase] || phase.toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const container = el('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
}

// Boot
document.addEventListener('DOMContentLoaded', init);
