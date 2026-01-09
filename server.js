const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const solutions = JSON.parse(fs.readFileSync('./solutions.json', 'utf8'));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GRID_SIZE = 12; 
const BOARD_UNITS = 36;
const BOARD_LIMIT = BOARD_UNITS * GRID_SIZE; 

// The "Single Source of Truth" for all games
const rooms = new Map(); 

function getRoomState(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            pieces: [],
            inventory: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 },
            users: {}
        });
    }
    return rooms.get(roomId);
}

function emitUsers(roomId) {
    const state = getRoomState(roomId);
    io.to(roomId).emit('usersUpdate', { roomId, users: state.users });
}

const CALM_COLORS = {
    1: "#b8c1ec", 2: "#a2d2ff", 3: "#ccd5ae", 4: "#e9edc9",
    5: "#fae1dd", 6: "#fec89a", 7: "#dec0f1", 8: "#957fef"
};

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('joinRoom', (payload) => {
        const roomId = typeof payload === 'string' ? payload : payload?.roomId;
        const requestedName = typeof payload === 'string' ? null : payload?.name;
        const name = (requestedName || '').trim();

        // Require a name for a good multiplayer UX.
        if (!name) {
            socket.emit('nameRequired');
            return;
        }

        // If switching rooms, leave the previous room and drop any held piece there.
        if (currentRoom && currentRoom !== roomId) {
            socket.leave(currentRoom);
            const prevState = getRoomState(currentRoom);
            delete prevState.users[socket.id];
            const held = prevState.pieces.find(p => p.heldBy === socket.id);
            if (held) {
                held.heldBy = null;
                io.to(currentRoom).emit('stateUpdate', prevState);
            }
            emitUsers(currentRoom);
        }
        currentRoom = roomId;
        socket.join(roomId);
        const state = getRoomState(roomId);
        state.users[socket.id] = name;
        // Initialize the client with the specific room state
        socket.emit('init', { id: socket.id, roomId, ...state });
        emitUsers(roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);
    });

    socket.on('startGame', (data) => {
        const state = getRoomState(data.roomId);
        
        // 1. Clear current state
        state.pieces = [];
        state.inventory = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
        
        const template = solutions["1"].grid; 
        const fillProbability = data.difficulty === 'easy' ? 0.6 : data.difficulty === 'medium' ? 0.3 : 0.1;
        const seededPieces = extractPiecesFromTemplate(template, fillProbability);
        
        seededPieces.forEach(p => {
            state.pieces.push(p);
            state.inventory[p.size]--;
        });
    
        // 2. SAVE THE SNAPSHOT of this initial seeded state
        state.initialPieces = JSON.parse(JSON.stringify(state.pieces));
        state.initialInventory = JSON.parse(JSON.stringify(state.inventory));
    
        io.to(data.roomId).emit('stateUpdate', state);
    });

    socket.on('spawnPiece', (data) => {
        const state = getRoomState(data.roomId);
        if (state.inventory[data.size] > 0) {
            const newPiece = {
                id: `p${Date.now()}`,
                size: data.size,
                x: BOARD_LIMIT + 20, 
                y: 20,
                heldBy: socket.id, 
                isLocked: false,
                color: CALM_COLORS[data.size]
            };
            state.inventory[data.size]--;
            state.pieces.push(newPiece);
            io.to(data.roomId).emit('stateUpdate', state);
        }
    });

    socket.on('pickUp', (data) => {
        const state = getRoomState(data.roomId);
        const piece = state.pieces.find(p => p.id === data.pieceId);
        if (piece && !piece.heldBy) {
            piece.heldBy = socket.id;
            io.to(data.roomId).emit('stateUpdate', state);
        }
    });

    socket.on('movePiece', (data) => {
        const state = getRoomState(data.roomId);
        const piece = state.pieces.find(p => p.id === data.id);
        if (piece && piece.heldBy === socket.id) {
            piece.x = data.x;
            piece.y = data.y;
            io.to(data.roomId).emit('stateUpdate', state);
        }
    });

    socket.on('dropPiece', (data) => {
        const state = getRoomState(data.roomId);
        const piece = state.pieces.find(p => p.heldBy === socket.id);
        if (piece) {
            piece.heldBy = null;
            io.to(data.roomId).emit('stateUpdate', state);
        }
    });

    socket.on('resetBoard', (data) => {
        const state = getRoomState(data.roomId);
        
        // 3. RESTORE from the snapshot if it exists
        if (state.initialPieces) {
            state.pieces = JSON.parse(JSON.stringify(state.initialPieces));
            state.inventory = JSON.parse(JSON.stringify(state.initialInventory));
        } else {
            // Fallback if they reset before ever choosing a difficulty
            state.pieces = [];
            state.inventory = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
        }
    
        io.to(data.roomId).emit('stateUpdate', state);
        console.log(`Room ${data.roomId} reset to initial seed.`);
    });

    socket.on('checkSolution', (data) => {
        const state = getRoomState(data.roomId);
        let currentGrid = Array.from({ length: 36 }, () => Array(36).fill(0));
        state.pieces.forEach(p => {
            for (let row = 0; row < p.size; row++) {
                for (let col = 0; col < p.size; col++) {
                    let ty = (p.y / GRID_SIZE) + row;
                    let tx = (p.x / GRID_SIZE) + col;
                    if (ty >= 0 && ty < 36 && tx >= 0 && tx < 36) currentGrid[ty][tx] = p.size;
                }
            }
        });
        let isCorrect = Object.values(solutions).some(sol => JSON.stringify(sol.grid) === JSON.stringify(currentGrid));
        socket.emit('solutionResult', isCorrect);
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            const state = getRoomState(currentRoom);
            delete state.users[socket.id];
            const piece = state.pieces.find(p => p.heldBy === socket.id);
            if (piece) {
                piece.heldBy = null;
                io.to(currentRoom).emit('stateUpdate', state);
            }
            emitUsers(currentRoom);
        }
    });
});

// Helper stays the same
function extractPiecesFromTemplate(template, fillProbability) {
    let seeded = [];
    let processed = Array.from({ length: 36 }, () => Array(36).fill(false));
    let idCounter = Date.now();
    for (let r = 0; r < 36; r++) {
        for (let c = 0; c < 36; c++) {
            let size = template[r][c];
            if (size > 0 && !processed[r][c]) {
                for (let i = 0; i < size; i++) {
                    for (let j = 0; j < size; j++) {
                        if (r + i < 36 && c + j < 36) processed[r + i][c + j] = true;
                    }
                }
                if (Math.random() < fillProbability) {
                    seeded.push({
                        id: `p${idCounter++}`,
                        size: size,
                        x: c * GRID_SIZE,
                        y: r * GRID_SIZE,
                        heldBy: null,
                        isLocked: true,
                        color: CALM_COLORS[size]
                    });
                }
            }
        }
    }
    return seeded;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));