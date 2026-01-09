const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GRID_SIZE = 12; 
const BOARD_UNITS = 36;
const BOARD_PIXEL_SIZE = BOARD_UNITS * GRID_SIZE;

let pieces = [];
let idCounter = 0;

// Generate the supply: 8x size 8, 7x size 7... 1x size 1
let inventory = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // FIX 1: Send both pieces AND inventory on initialization
    socket.emit('init', { id: socket.id, pieces, inventory });

    socket.on('spawnPiece', (size) => {
        if (inventory[size] > 0) {
            const newPiece = {
                id: `p${Date.now()}`,
                size: size,
                x: BOARD_PIXEL_SIZE + 20,
                y: 20,
                heldBy: socket.id,
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
            // FIX 2: Consistently emit both pieces and inventory
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

    socket.on('disconnect', () => {
        const piece = pieces.find(p => p.heldBy === socket.id);
        if (piece) {
            piece.heldBy = null;
            io.emit('stateUpdate', { pieces, inventory });
        }
        console.log('User disconnected');
    });
});
// server.listen(3000, () => console.log('Server running on port 3000'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});