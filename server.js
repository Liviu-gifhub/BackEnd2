/**
 * Tic-Tac-Toe Multiplayer - Backend Server
 * 
 * Server Node.js con Express e Socket.IO per gestire partite
 * multiplayer in tempo reale.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Inizializzazione app Express
const app = express();
app.use(cors());

// Creazione server HTTP
const server = http.createServer(app);

// Inizializzazione Socket.IO con CORS abilitato
const io = new Server(server, {
    cors: {
        origin: "*", // Permette connessioni da qualsiasi origine (per Hostinger)
        methods: ["GET", "POST"]
    }
});

// Porta del server (Render imposta PORT automaticamente)
const PORT = process.env.PORT || 3000;

// ==========================================
// GESTIONE STANZE
// ==========================================

/**
 * Struttura di una stanza:
 * {
 *   code: string,           // Codice univoco 6 caratteri
 *   players: [socketId, socketId], // Max 2 giocatori
 *   board: [null, null, ...], // 9 celle, null = vuota, 'X' o 'O'
 *   currentPlayer: 'X' | 'O',
 *   gameActive: boolean
 * }
 */
const rooms = new Map();

/**
 * Genera un codice stanza univoco di 6 caratteri alfanumerici
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (rooms.has(code)); // Assicura unicità
    return code;
}

/**
 * Crea una nuova stanza
 */
function createRoom(socketId) {
    const code = generateRoomCode();
    const room = {
        code: code,
        players: [socketId],
        board: Array(9).fill(null),
        currentPlayer: 'X', // X inizia sempre
        gameActive: false,
        symbols: {} // Mappa socketId -> 'X' o 'O'
    };
    room.symbols[socketId] = 'X'; // Il creatore è X
    rooms.set(code, room);
    return room;
}

/**
 * Cerca una stanza per codice
 */
function getRoom(code) {
    return rooms.get(code.toUpperCase());
}

/**
 * Trova la stanza di un giocatore
 */
function findPlayerRoom(socketId) {
    for (const [code, room] of rooms) {
        if (room.players.includes(socketId)) {
            return room;
        }
    }
    return null;
}

// ==========================================
// LOGICA DI GIOCO
// ==========================================

/**
 * Combinazioni vincenti (indici delle celle)
 */
const WINNING_COMBINATIONS = [
    [0, 1, 2], // Riga 1
    [3, 4, 5], // Riga 2
    [6, 7, 8], // Riga 3
    [0, 3, 6], // Colonna 1
    [1, 4, 7], // Colonna 2
    [2, 5, 8], // Colonna 3
    [0, 4, 8], // Diagonale principale
    [2, 4, 6]  // Diagonale secondaria
];

/**
 * Controlla se c'è un vincitore
 * @returns 'X', 'O', 'draw', o null
 */
function checkWinner(board) {
    // Controlla combinazioni vincenti
    for (const combo of WINNING_COMBINATIONS) {
        const [a, b, c] = combo;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a]; // Ritorna 'X' o 'O'
        }
    }
    
    // Controlla pareggio (nessuna cella vuota)
    if (board.every(cell => cell !== null)) {
        return 'draw';
    }
    
    return null; // Partita in corso
}

/**
 * Resetta lo stato della partita
 */
function resetGame(room) {
    room.board = Array(9).fill(null);
    room.currentPlayer = 'X';
    room.gameActive = true;
}

// ==========================================
// GESTIONE EVENTI SOCKET.IO
// ==========================================

io.on('connection', (socket) => {
    console.log(`[CONNESSO] ${socket.id}`);

    /**
     * Evento: createRoom
     * Crea una nuova stanza e restituisce il codice
     */
    socket.on('createRoom', () => {
        // Verifica che il giocatore non sia già in una stanza
        const existingRoom = findPlayerRoom(socket.id);
        if (existingRoom) {
            socket.emit('error', { message: 'Sei già in una stanza.' });
            return;
        }

        const room = createRoom(socket.id);
        socket.join(room.code);
        
        console.log(`[STANZA CREATA] ${room.code} da ${socket.id}`);
        
        socket.emit('roomCreated', {
            roomCode: room.code,
            symbol: 'X'
        });
    });

    /**
     * Evento: joinRoom
     * Entra in una stanza esistente
     */
    socket.on('joinRoom', (data) => {
        const code = data.roomCode?.toUpperCase();
        
        // Validazione codice
        if (!code || code.length !== 6) {
            socket.emit('error', { message: 'Codice stanza non valido.' });
            return;
        }

        // Cerca la stanza
        const room = getRoom(code);
        if (!room) {
            socket.emit('error', { message: 'Stanza non trovata.' });
            return;
        }

        // Controlla se la stanza è piena
        if (room.players.length >= 2) {
            socket.emit('error', { message: 'Stanza piena.' });
            return;
        }

        // Verifica che il giocatore non sia già in una stanza
        const existingRoom = findPlayerRoom(socket.id);
        if (existingRoom) {
            socket.emit('error', { message: 'Sei già in una stanza.' });
            return;
        }

        // Aggiungi giocatore alla stanza
        room.players.push(socket.id);
        room.symbols[socket.id] = 'O'; // Il secondo giocatore è O
        room.gameActive = true;
        socket.join(room.code);

        console.log(`[JOIN] ${socket.id} entra nella stanza ${room.code}`);

        // Notifica il giocatore che ha fatto join
        socket.emit('joinedRoom', {
            roomCode: room.code,
            symbol: 'O'
        });

        // Notifica entrambi i giocatori che la partita inizia
        io.to(room.code).emit('gameStart', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            message: 'La partita è iniziata! X inizia.'
        });
    });

    /**
     * Evento: makeMove
     * Effettua una mossa
     */
    socket.on('makeMove', (data) => {
        const room = findPlayerRoom(socket.id);
        
        if (!room) {
            socket.emit('error', { message: 'Non sei in una stanza.' });
            return;
        }

        if (!room.gameActive) {
            socket.emit('error', { message: 'La partita non è attiva.' });
            return;
        }

        const playerSymbol = room.symbols[socket.id];
        const cellIndex = data.cellIndex;

        // Verifica che sia il turno del giocatore
        if (playerSymbol !== room.currentPlayer) {
            socket.emit('error', { message: 'Non è il tuo turno.' });
            return;
        }

        // Verifica validità della mossa
        if (cellIndex < 0 || cellIndex > 8 || room.board[cellIndex] !== null) {
            socket.emit('error', { message: 'Mossa non valida.' });
            return;
        }

        // Effettua la mossa
        room.board[cellIndex] = playerSymbol;
        room.currentPlayer = playerSymbol === 'X' ? 'O' : 'X';

        console.log(`[MOSSA] ${socket.id} (${playerSymbol}) -> cella ${cellIndex}`);

        // Controlla vittoria/pareggio
        const winner = checkWinner(room.board);

        if (winner) {
            room.gameActive = false;
            
            let message;
            if (winner === 'draw') {
                message = 'Pareggio!';
            } else {
                message = `${winner} ha vinto!`;
            }

            io.to(room.code).emit('gameEnd', {
                board: room.board,
                winner: winner,
                message: message
            });

            console.log(`[FINE PARTITA] Stanza ${room.code}: ${message}`);
        } else {
            // Partita in corso, notifica la mossa
            io.to(room.code).emit('moveMade', {
                board: room.board,
                currentPlayer: room.currentPlayer,
                lastMove: {
                    cellIndex: cellIndex,
                    symbol: playerSymbol
                }
            });
        }
    });

    /**
     * Evento: newGame
     * Richiede una nuova partita nella stessa stanza
     */
    socket.on('newGame', () => {
        const room = findPlayerRoom(socket.id);
        
        if (!room) {
            socket.emit('error', { message: 'Non sei in una stanza.' });
            return;
        }

        if (room.players.length !== 2) {
            socket.emit('error', { message: 'Servono 2 giocatori per iniziare.' });
            return;
        }

        resetGame(room);

        console.log(`[NUOVA PARTITA] Stanza ${room.code}`);

        io.to(room.code).emit('gameStart', {
            board: room.board,
            currentPlayer: room.currentPlayer,
            message: 'Nuova partita! X inizia.'
        });
    });

    /**
     * Evento: disconnect
     * Gestisce la disconnessione di un giocatore
     */
    socket.on('disconnect', () => {
        console.log(`[DISCONNESSO] ${socket.id}`);

        const room = findPlayerRoom(socket.id);
        if (room) {
            // Rimuovi giocatore dalla stanza
            room.players = room.players.filter(id => id !== socket.id);
            delete room.symbols[socket.id];
            room.gameActive = false;

            // Notifica l'altro giocatore
            io.to(room.code).emit('playerDisconnected', {
                message: 'L\'avversario si è disconnesso.'
            });

            // Se la stanza è vuota, eliminala
            if (room.players.length === 0) {
                rooms.delete(room.code);
                console.log(`[STANZA ELIMINATA] ${room.code}`);
            }
        }
    });
});

// ==========================================
// ENDPOINT HTTP (per health check)
// ==========================================

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        game: 'Tic-Tac-Toe Multiplayer',
        rooms: rooms.size
    });
});

// ==========================================
// AVVIO SERVER
// ==========================================

server.listen(PORT, () => {
    console.log(`🎮 Server Tic-Tac-Toe avviato sulla porta ${PORT}`);
});
