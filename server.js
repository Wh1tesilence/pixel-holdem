const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameEngine } = require('./public/js/game-engine.js');
const { ROOM_CODE_LENGTH, ACTION_TIMEOUT_MS } = require('./public/js/constants.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingInterval: 5000,
  pingTimeout: 30000,
  connectTimeout: 10000,
  maxHttpBufferSize: 1e5,
  allowEIO3: true,
  perMessageDeflate: {
    threshold: 1024
  }
});
const PORT = process.env.PORT || 3000;

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Room storage ----
const rooms = {}; // roomId → { players: [{socketId, playerName, seatIdx}], engine: GameEngine, host: socketId, timers: {} }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing 0/O/1/I
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoom() {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms[code]);
  rooms[code] = { players: [], engine: null, host: null, timers: {} };
  return code;
}

function broadcastRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit('room_update', {
    players: room.players.map(p => ({ name: p.playerName, seatIdx: p.seatIdx })),
    hostId: room.host,
    gameStarted: room.engine !== null
  });
}

function broadcastGameState(roomId) {
  const room = rooms[roomId];
  if (!room || !room.engine) return;

  for (const p of room.players) {
    const state = room.engine.getState(p.playerName); // playerName is used as playerId
    io.to(p.socketId).emit('game_state', state);
  }
}

function clearTimer(roomId, playerName) {
  const room = rooms[roomId];
  if (!room) return;
  const key = `${roomId}_${playerName}`;
  if (room.timers[key]) {
    clearTimeout(room.timers[key]);
    delete room.timers[key];
  }
}

function setTimer(roomId) {
  const room = rooms[roomId];
  if (!room || !room.engine) return;

  const engine = room.engine;
  const currentPlayer = engine.players[engine.currentPlayerIdx];
  if (!currentPlayer || currentPlayer.folded || currentPlayer.isAllIn) return;

  const key = `${roomId}_${currentPlayer.id}`;

  // Clear existing timer
  if (room.timers[key]) {
    clearTimeout(room.timers[key]);
  }

  room.timers[key] = setTimeout(() => {
    console.log(`Player ${currentPlayer.name} auto-folded (timeout)`);
    engine.handleAction(currentPlayer.id, 'fold');
    broadcastGameState(roomId);
    setTimer(roomId);
  }, ACTION_TIMEOUT_MS);
}

// ---- Socket.io ----

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Create room
  socket.on('create_room', (data) => {
    const { playerName } = data;
    if (!playerName || playerName.trim() === '') {
      socket.emit('error', { message: 'Please enter a name' });
      return;
    }

    const roomId = createRoom();
    socket.join(roomId);

    rooms[roomId].players.push({
      socketId: socket.id,
      playerName: playerName.trim(),
      seatIdx: 0
    });
    rooms[roomId].host = socket.id;

    socket.emit('room_created', { roomId, playerName: playerName.trim() });
    broadcastRoom(roomId);
    console.log(`Room ${roomId} created by ${playerName}`);
  });

  // Join room
  socket.on('join_room', (data) => {
    const { roomId, playerName } = data;
    if (!playerName || playerName.trim() === '') {
      socket.emit('error', { message: 'Please enter a name' });
      return;
    }

    const code = roomId.toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.engine) {
      socket.emit('error', { message: 'Game already started' });
      return;
    }

    if (room.players.length >= 9) {
      socket.emit('error', { message: 'Room is full (max 9 players)' });
      return;
    }

    // Check name uniqueness
    if (room.players.some(p => p.playerName === playerName.trim())) {
      socket.emit('error', { message: 'Name already taken in this room' });
      return;
    }

    socket.join(code);

    const seatIdx = room.players.length;
    room.players.push({
      socketId: socket.id,
      playerName: playerName.trim(),
      seatIdx
    });

    socket.emit('room_joined', {
      roomId: code,
      playerName: playerName.trim(),
      seatIdx,
      players: room.players.map(p => ({ name: p.playerName, seatIdx: p.seatIdx }))
    });
    broadcastRoom(code);
    console.log(`${playerName} joined room ${code}`);
  });

  // Start game (host only)
  socket.on('start_game', () => {
    // Find which room this socket is in
    let foundRoomId = null;
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players.some(p => p.socketId === socket.id)) {
        foundRoomId = roomId;
        break;
      }
    }

    if (!foundRoomId) {
      socket.emit('error', { message: 'You are not in a room' });
      return;
    }

    const room = rooms[foundRoomId];
    if (room.host !== socket.id) {
      socket.emit('error', { message: 'Only the host can start the game' });
      return;
    }

    if (room.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players' });
      return;
    }

    // Create game engine with player names
    const playerNames = room.players.map(p => p.playerName);
    room.engine = new GameEngine(playerNames);

    // Start first hand
    room.engine.startHand();

    // Broadcast initial state
    broadcastGameState(foundRoomId);
    broadcastRoom(foundRoomId);

    // Start timer for first player
    setTimer(foundRoomId);
    console.log(`Game started in room ${foundRoomId}`);
  });

  // Player action
  socket.on('player_action', (data) => {
    const { action, amount } = data;

    // Find room
    let foundRoomId = null;
    let foundPlayer = null;
    for (const [roomId, room] of Object.entries(rooms)) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        foundRoomId = roomId;
        foundPlayer = player;
        break;
      }
    }

    if (!foundRoomId || !rooms[foundRoomId].engine) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }

    const engine = rooms[foundRoomId].engine;
    const result = engine.handleAction(foundPlayer.playerName, action, amount);

    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    // Clear timer for this player
    clearTimer(foundRoomId, foundPlayer.playerName);

    // Broadcast new state
    broadcastGameState(foundRoomId);

    // If hand ended, auto-start next hand after delay
    if (engine.phase === 'hand_end') {
      setTimeout(() => {
        const nextResult = engine.nextHand();
        if (nextResult.gameOver) {
          io.to(foundRoomId).emit('game_over', { winner: nextResult.winner.name });
        } else {
          broadcastGameState(foundRoomId);
          broadcastRoom(foundRoomId);
          setTimer(foundRoomId);
        }
      }, 5000); // 5s pause to show results
    } else {
      // Start timer for next player
      setTimer(foundRoomId);
    }
  });

  // Leave room
  socket.on('leave_room', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        const player = room.players[idx];
        room.players.splice(idx, 1);
        socket.leave(roomId);

        // If game is running, fold the player
        if (room.engine) {
          const enginePlayer = room.engine.getPlayer(player.playerName);
          if (enginePlayer && !enginePlayer.folded) {
            enginePlayer.folded = true;
            enginePlayer.isActive = false;
            broadcastGameState(roomId);
          }
        }

        clearTimer(roomId, player.playerName);

        // Clean up empty rooms
        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted (empty)`);
        } else {
          // Transfer host if needed
          if (room.host === socket.id && room.players.length > 0) {
            room.host = room.players[0].socketId;
          }
          broadcastRoom(roomId);
        }

        console.log(`${player.playerName} left room ${roomId}`);
        break;
      }
    }
  });

  // Rejoin room (after refresh/disconnect)
  socket.on('rejoin_room', (data) => {
    const { roomId, playerName } = data;
    const room = rooms[roomId.toUpperCase().trim()];

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const player = room.players.find(p => p.playerName === playerName);
    if (!player) {
      socket.emit('error', { message: 'Player not found in room' });
      return;
    }

    // Update socket ID
    player.socketId = socket.id;
    socket.join(roomId);

    socket.emit('room_joined', {
      roomId: roomId.toUpperCase().trim(),
      playerName,
      seatIdx: player.seatIdx,
      players: room.players.map(p => ({ name: p.playerName, seatIdx: p.seatIdx }))
    });

    // Send current game state if game is running
    if (room.engine) {
      const state = room.engine.getState(playerName);
      socket.emit('game_state', state);
    }

    broadcastRoom(roomId);
    console.log(`${playerName} rejoined room ${roomId}`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    // Don't auto-remove player on temporary disconnect
    // The leave_room event handles explicit leaves
    // Timeout will handle auto-fold for disconnected players in game
  });
});

server.listen(PORT, () => {
  console.log(`Pixel Hold'em server running on http://localhost:${PORT}`);
});
