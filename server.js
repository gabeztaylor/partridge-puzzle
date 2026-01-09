const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// Load solutions from local directory
const solutions = JSON.parse(fs.readFileSync('./solutions.json', 'utf8'));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GRID_SIZE = 12; 
const BOARD_UNITS = 36;
const BOARD_PIXEL_SIZE = BOARD_UNITS * GRID_SIZE;
const BOARD_LIMIT = BOARD_PIXEL_SIZE; 

let pieces = [];
let inventory = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.emit('init', { id: socket.id, pieces, inventory });

    // Handles the difficulty selection from the home screen
    socket.on('startGame', (difficulty) => {
        pieces = [];
        inventory = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
        const template = solutions["1"].grid; 
        
        const fillProbability = difficulty === 'easy' ? 0.6 : difficulty === 'medium' ? 0.3 : 0.1;
        const seededPieces = extractPiecesFromTemplate(template, fillProbability);
        
        seededPieces.forEach(p => {
            pieces.push(p);
            inventory[p.size]--;
        });
        io.emit('stateUpdate', { pieces, inventory });
    });

    socket.on('spawnPiece', (size) => {
        if (inventory[size] > 0) {
            const newPiece = {
                id: `p${Date.now()}`,
                size: size,
                x: BOARD_LIMIT + 20, 
                y: 20,
                heldBy: socket.id, 
                isLocked: false,
                color: `hsl(${(size * 45) % 360}, 65%, 50%)`
            };
            inventory[size]--;
            pieces.push(newPiece);
            io.emit('stateUpdate', { pieces, inventory });
        }
    });

    socket.on('pickUp', (pieceId) => {
        const piece = pieces.find(p => p.id === pieceId);
        if (piece && !piece.heldBy) {
            piece.heldBy = socket.id;
            io.emit('stateUpdate', { pieces, inventory });
        }
    });

    socket.on('movePiece', (data) => {
        const piece = pieces.find(p => p.id === data.id);
        if (piece && piece.heldBy === socket.id) {
            piece.x = data.x;
            piece.y = data.y;
            io.emit('stateUpdate', { pieces, inventory });
        }
    });

    socket.on('dropPiece', () => {
        const piece = pieces.find(p => p.heldBy === socket.id);
        if (piece) {
            piece.heldBy = null;
            io.emit('stateUpdate', { pieces, inventory });
        }
    });

    socket.on('resetBoard', () => {
        pieces = [];
        inventory = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
        io.emit('stateUpdate', { pieces, inventory });
    });

    socket.on('checkSolution', () => {
        let currentGrid = Array.from({ length: 36 }, () => Array(36).fill(0));
        pieces.forEach(p => {
            for (let row = 0; row < p.size; row++) {
                for (let col = 0; col < p.size; col++) {
                    let targetY = (p.y / GRID_SIZE) + row;
                    let targetX = (p.x / GRID_SIZE) + col;
                    if (targetY >= 0 && targetY < 36 && targetX >= 0 && targetX < 36) {
                        currentGrid[targetY][targetX] = p.size;
                    }
                }
            }
        });
        let isCorrect = false;
        Object.values(solutions).forEach(sol => {
            if (JSON.stringify(sol.grid) === JSON.stringify(currentGrid)) isCorrect = true;
        });
        socket.emit('solutionResult', isCorrect);
    });

    socket.on('disconnect', () => {
        const piece = pieces.find(p => p.heldBy === socket.id);
        if (piece) {
            piece.heldBy = null;
            io.emit('stateUpdate', { pieces, inventory });
        }
    });
});

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
                        color: `hsl(${(size * 45) % 360}, 65%, 50%)`
                    });
                }
            }
        }
    }
    return seeded;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));