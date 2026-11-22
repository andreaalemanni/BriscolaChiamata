// Briscola Chiamata — server (Express + Socket.io)
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./src/room');
const B = require('./src/bots');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || 'briscola';
if (!process.env.PASSWORD) console.warn('ATTENZIONE: variabile PASSWORD non impostata, uso "briscola"');
B.CFG.samples = Number(process.env.BOT_SAMPLES || 50);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function broadcastLobby() {
  io.to('lobby').emit('lobby', [...rooms.values()].map((r) => r.summary()));
}
function broadcastRoom(room) {
  for (const [, s] of io.of('/').sockets) {
    if (s.data.roomId === room.id) s.emit('room', room.viewFor(s.data.clientId));
  }
}
let lobbyPending = false;
function onRoomChange(room) {
  broadcastRoom(room);
  if (!lobbyPending) { lobbyPending = true; setImmediate(() => { lobbyPending = false; broadcastLobby(); }); }
}

// pulizia dei tavoli vuoti
setInterval(() => {
  for (const [id, r] of rooms) {
    const noHumans = !r.connectedHumans().length;
    if (noHumans && ((r.status === 'lobby' && !r.humans().length) || (r.emptySince && Date.now() - r.emptySince > 15 * 60 * 1000))) {
      clearTimeout(r.timer);
      rooms.delete(id);
    }
  }
  broadcastLobby();
}, 60 * 1000);

io.use((socket, next) => {
  const pw = socket.handshake.auth && socket.handshake.auth.password;
  if (pw !== PASSWORD) return next(new Error('password'));
  next();
});

io.on('connection', (socket) => {
  const wrap = (fn) => (payload, ack) => {
    try { fn(payload || {}); if (typeof ack === 'function') ack({ ok: true }); } catch (e) {
      if (typeof ack === 'function') ack({ ok: false, error: e.message });
      else socket.emit('errorMsg', e.message);
    }
  };
  const room = () => rooms.get(socket.data.roomId);
  const needName = () => { if (!socket.data.name) throw new Error('Inserisci il tuo nome'); };

  socket.on('hello', wrap(({ clientId, name }) => {
    socket.data.clientId = String(clientId || '').slice(0, 64) || socket.id;
    socket.data.name = String(name || '').trim().slice(0, 16);
    socket.join('lobby');
    socket.emit('lobby', [...rooms.values()].map((r) => r.summary()));
  }));

  socket.on('createRoom', wrap(({ name, targetScore, seats }) => {
    needName();
    leaveCurrent();
    const kinds = Array.isArray(seats) ? seats.slice(0, 4) : [];
    const r = new Room({ name, targetScore: Number(targetScore), seatKinds: kinds, onChange: onRoomChange });
    rooms.set(r.id, r);
    socket.data.roomId = r.id;
    r.join(socket.data.clientId, socket.data.name);
  }));

  socket.on('joinRoom', wrap(({ roomId }) => {
    needName();
    const r = rooms.get(roomId);
    if (!r) throw new Error('Tavolo non trovato');
    if (socket.data.roomId && socket.data.roomId !== roomId) leaveCurrent();
    r.join(socket.data.clientId, socket.data.name);
    socket.data.roomId = r.id;
    socket.emit('room', r.viewFor(socket.data.clientId));
  }));

  function leaveCurrent() {
    const r = room();
    if (r) r.leave(socket.data.clientId);
    socket.data.roomId = null;
  }
  socket.on('leaveRoom', wrap(() => { leaveCurrent(); socket.emit('room', null); }));
  socket.on('start', wrap(() => room().start(socket.data.clientId)));
  socket.on('rematch', wrap(() => room().rematch(socket.data.clientId)));
  socket.on('seat', wrap(({ seat, kind }) => room().configureSeat(socket.data.clientId, Number(seat), kind)));
  socket.on('target', wrap(({ target }) => room().setTarget(socket.data.clientId, Number(target))));
  socket.on('bid', wrap(({ level }) => room().humanBid(socket.data.clientId, level === null || level === undefined ? null : level)));
  socket.on('call', wrap(({ suit }) => room().humanCall(socket.data.clientId, suit)));
  socket.on('play', wrap(({ card }) => room().humanPlay(socket.data.clientId, card)));
  socket.on('chat', wrap(({ text, quick }) => { const r = room(); if (r) r.addChat(socket.data.clientId, text, quick); }));

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    // se lo stesso giocatore ha un'altra connessione aperta non lo considero uscito
    const other = [...io.of('/').sockets.values()].some((s) => s !== socket && s.data.clientId === socket.data.clientId && s.data.roomId === r.id);
    if (!other) r.leave(socket.data.clientId, { disconnect: true });
  });
});

server.listen(PORT, () => console.log(`Briscola Chiamata in ascolto sulla porta ${PORT}`));
