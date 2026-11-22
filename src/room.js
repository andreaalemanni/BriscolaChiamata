// Gestione di un tavolo: posti, bot, flusso delle mani, punteggi, chat, storico
'use strict';
const E = require('./engine');
const B = require('./bots');

const BOT_NAMES = ['Gino', 'Pina', 'Tonio', 'Rosa', 'Beppe', 'Nella', 'Franco', 'Lella', 'Carmelo', 'Ornella', 'Ugo', 'Tina'];
const LEVEL_LABEL = { easy: 'facile', medium: 'medio', hard: 'difficile' };
const QUICK = {
  carica: 'Carica! 💰',
  liscio: 'Liscio 🍃',
  taglia: 'Taglia! ✂️',
  briscola: 'Gioca briscola!',
  bravo: 'Bravo! 👏',
  ahia: 'Ahia… 😬',
};
const SPEED = Number(process.env.SPEED || 1); // solo per i test: SPEED=0.3 accelera i bot
const DELAY = Object.fromEntries(Object.entries({ bid: 900, call: 1100, play: 950, trick: 1700, redeal: 2200, nextHand: 9000 }).map(([k, v]) => [k, v * SPEED]));

let nextId = 1;

class Room {
  constructor({ name, targetScore, seatKinds, onChange }) {
    this.id = String(nextId++).padStart(3, '0') + Math.random().toString(36).slice(2, 6);
    this.name = (name || 'Tavolo').slice(0, 30);
    this.targetScore = [5, 10, 15, 20, 25, 30].includes(targetScore) ? targetScore : 10;
    this.onChange = onChange;
    this.seats = [];
    this.usedBotNames = new Set();
    for (let i = 0; i < E.NPLAYERS; i++) this.seats.push(this.makeSeat(i === 0 ? 'open' : seatKinds[i - 1] || 'open'));
    this.status = 'lobby';
    this.scores = Array(E.NPLAYERS).fill(0);
    this.history = [];
    this.chat = [];
    this.hand = null;
    this.dealer = Math.floor(Math.random() * E.NPLAYERS);
    this.handNo = 0;
    this.timer = null;
    this.nextHandAt = null;
    this.winners = null;
    this.hostClient = null;
    this.emptySince = null;
  }

  makeSeat(kind) {
    if (kind === 'easy' || kind === 'medium' || kind === 'hard') {
      const free = BOT_NAMES.filter((n) => !this.usedBotNames.has(n));
      const name = free[Math.floor(Math.random() * free.length)] || 'Bot';
      this.usedBotNames.add(name);
      return { kind: 'bot', level: kind, name, clientId: null, connected: true };
    }
    return { kind: 'open', name: null, clientId: null, connected: false };
  }

  setBotSeat(i, kind) {
    const old = this.seats[i];
    if (old.kind === 'bot') this.usedBotNames.delete(old.name);
    this.seats[i] = this.makeSeat(kind);
  }

  humans() { return this.seats.filter((s) => s.kind === 'human'); }
  connectedHumans() { return this.seats.filter((s) => s.kind === 'human' && s.connected); }
  seatOf(clientId) { return this.seats.findIndex((s) => s.kind === 'human' && s.clientId === clientId); }
  hostSeat() { return this.seatOf(this.hostClient); }

  // ------- ingresso / uscita -------
  join(clientId, name) {
    const existing = this.seatOf(clientId);
    if (existing >= 0) { this.seats[existing].connected = true; this.seats[existing].name = name; this.afterReconnect(); return existing; }
    // rientro con lo stesso nome su un posto lasciato a un bot
    const byName = this.seats.findIndex((s) => s.kind === 'human' && !s.connected && s.name.toLowerCase() === name.toLowerCase());
    if (byName >= 0) {
      Object.assign(this.seats[byName], { clientId, connected: true });
      this.addSystem(`${name} è rientrato al tavolo`);
      this.afterReconnect();
      return byName;
    }
    if (this.seats.some((s) => s.kind === 'human' && s.connected && s.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('C\'è già un giocatore con questo nome al tavolo');
    }
    if (this.status !== 'lobby') throw new Error('La partita è già iniziata');
    const open = this.seats.findIndex((s) => s.kind === 'open');
    if (open < 0) throw new Error('Il tavolo è pieno');
    this.seats[open] = { kind: 'human', name, clientId, connected: true };
    if (!this.hostClient || this.hostSeat() < 0) this.hostClient = clientId;
    this.addSystem(`${name} si è seduto al tavolo`);
    this.changed();
    return open;
  }

  afterReconnect() {
    this.emptySince = null;
    this.changed();
    this.tick();
  }

  leave(clientId, { disconnect = false } = {}) {
    const i = this.seatOf(clientId);
    if (i < 0) return;
    const s = this.seats[i];
    if (this.status === 'lobby') {
      this.seats[i] = this.makeSeat('open');
      if (!disconnect) this.addSystem(`${s.name} ha lasciato il tavolo`);
    } else {
      s.connected = false;
      this.addSystem(`${s.name} è uscito: gioca un bot medio al suo posto finché non rientra`);
    }
    if (this.hostClient === clientId) {
      const other = this.seats.find((x) => x.kind === 'human' && x.connected);
      this.hostClient = other ? other.clientId : null;
    }
    if (!this.connectedHumans().length) this.emptySince = Date.now();
    this.changed();
    this.tick();
  }

  // ------- partita -------
  start(clientId) {
    if (clientId !== this.hostClient) throw new Error('Solo chi ha creato il tavolo può avviare');
    if (this.status === 'playing') return;
    for (let i = 0; i < E.NPLAYERS; i++) if (this.seats[i].kind === 'open') this.setBotSeat(i, 'medium');
    this.status = 'playing';
    this.scores = Array(E.NPLAYERS).fill(0);
    this.history = [];
    this.handNo = 0;
    this.winners = null;
    this.addSystem(`Si comincia! Vince chi arriva per primo a ${this.targetScore} punti.`);
    this.startHand();
  }

  startHand() {
    this.dealer = (this.dealer + 1) % E.NPLAYERS;
    this.handNo++;
    this.hand = E.newHand(this.dealer);
    this.nextHandAt = null;
    this.changed();
    this.tick();
  }

  actorKind(seat) {
    const s = this.seats[seat];
    if (s.kind === 'bot') return s.level;
    if (s.kind === 'human' && !s.connected) return 'medium';
    return null; // umano presente
  }

  schedule(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try { fn(); } catch (e) { console.error('Errore nel tavolo', this.id, e); }
    }, ms);
  }

  tick() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.status !== 'playing' || !this.hand) return;
    if (!this.connectedHumans().length) return; // tavolo in pausa senza umani
    const h = this.hand;
    if (h.phase === 'redeal') {
      return this.schedule(DELAY.redeal, () => { this.addSystem('Tutti hanno passato: si rimescola'); this.startHand(); });
    }
    if (h.phase === 'done') return this.schedule(Math.max(0, this.nextHandAt - Date.now()), () => this.startHand());
    if (h.phase === 'play' && h.trick.length === E.NPLAYERS) {
      return this.schedule(DELAY.trick, () => { E.resolveTrick(h); this.afterAction(); });
    }
    const actor = h.phase === 'auction' ? h.auction.turn : h.phase === 'call' ? h.caller : h.turn;
    const kind = this.actorKind(actor);
    if (!kind) return; // aspetta l'umano
    const delay = h.phase === 'auction' ? DELAY.bid : h.phase === 'call' ? DELAY.call : DELAY.play;
    this.schedule(delay, () => {
      if (this.hand !== h) return;
      if (h.phase === 'auction') E.bid(h, actor, B.chooseBid(h, actor, kind));
      else if (h.phase === 'call') E.callSuit(h, actor, B.chooseCallSuit(h, actor, kind));
      else if (h.phase === 'play') E.playCard(h, actor, B.chooseCard(h, actor, kind));
      this.afterAction();
    });
  }

  afterAction() {
    const h = this.hand;
    if (h.phase === 'call' && h.calledCardAnnounced !== true && h.caller !== null && !h.auctionAnnounced) {
      h.auctionAnnounced = true;
      this.addSystem(`${this.seats[h.caller].name} vince l'asta: ${E.levelLabel(h.level)}`);
    }
    if (h.phase === 'play' && !h.callAnnounced) {
      h.callAnnounced = true;
      this.addSystem(`Chiamato il ${E.cardName(h.calledCard)}, servono ${h.target} punti`);
    }
    if (h.revealed && !h.revealAnnounced && h.phase === 'play') {
      h.revealAnnounced = true;
      this.addSystem(h.partner === h.caller
        ? `${this.seats[h.caller].name} si era chiamato in mano: gioca da solo!`
        : `È uscita la carta chiamata: il socio è ${this.seats[h.partner].name}`);
    }
    if (h.phase === 'done' && !h.recorded) this.finishHand();
    this.changed();
    this.tick();
  }

  finishHand() {
    const h = this.hand;
    h.recorded = true;
    const r = h.result;
    r.delta.forEach((d, p) => (this.scores[p] += d));
    this.history.unshift({
      n: this.handNo,
      dealer: h.dealer,
      caller: h.caller,
      partner: h.partner,
      bid: E.levelLabel(h.level),
      called: E.cardId(h.calledCard),
      target: h.target,
      teamPoints: r.teamPoints,
      won: r.won,
      solo: r.solo,
      cappotto: r.cappotto,
      delta: r.delta,
      captured: h.captured.slice(),
    });
    const esito = r.won ? 'vince' : 'perde';
    this.addSystem(`${this.seats[h.caller].name} ${esito} con ${r.teamPoints} punti${r.cappotto ? ', cappotto!' : ''}`);
    const max = Math.max(...this.scores);
    if (max >= this.targetScore) {
      this.status = 'over';
      this.winners = this.scores.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0);
      this.addSystem(`Partita finita! Vince ${this.winners.map((i) => this.seats[i].name).join(' e ')} con ${max} punti 🏆`);
      this.nextHandAt = null;
    } else {
      this.nextHandAt = Date.now() + DELAY.nextHand;
    }
  }

  // ------- azioni umane -------
  requireTurn(clientId, phase) {
    const seat = this.seatOf(clientId);
    if (seat < 0) throw new Error('Non sei seduto a questo tavolo');
    const h = this.hand;
    if (!h || h.phase !== phase) throw new Error('Azione non disponibile adesso');
    return seat;
  }
  humanBid(clientId, level) {
    const seat = this.requireTurn(clientId, 'auction');
    E.bid(this.hand, seat, level === null ? null : Number(level));
    this.afterAction();
  }
  humanCall(clientId, suit) {
    const seat = this.requireTurn(clientId, 'call');
    E.callSuit(this.hand, seat, suit);
    this.afterAction();
  }
  humanPlay(clientId, id) {
    const seat = this.requireTurn(clientId, 'play');
    E.playCard(this.hand, seat, E.parseCard(String(id)));
    this.afterAction();
  }
  rematch(clientId) {
    if (clientId !== this.hostClient) throw new Error('Solo l\'host può ricominciare');
    if (this.status !== 'over') return;
    this.status = 'lobby';
    this.start(clientId);
  }
  configureSeat(clientId, i, kind) {
    if (clientId !== this.hostClient) throw new Error('Solo l\'host può cambiare i posti');
    if (this.status !== 'lobby') throw new Error('Partita già iniziata');
    if (!(i >= 0 && i < E.NPLAYERS) || this.seats[i].kind === 'human') throw new Error('Posto non modificabile');
    if (!['open', 'easy', 'medium', 'hard'].includes(kind)) throw new Error('Tipo non valido');
    this.setBotSeat(i, kind);
    this.changed();
  }
  setTarget(clientId, t) {
    if (clientId !== this.hostClient || this.status !== 'lobby') return;
    if ([5, 10, 15, 20, 25, 30].includes(t)) { this.targetScore = t; this.changed(); }
  }

  // ------- chat -------
  addSystem(text) { this.pushChat({ seat: null, name: null, text, system: true }); }
  addChat(clientId, text, quickKey) {
    const seat = this.seatOf(clientId);
    if (seat < 0) return;
    if (quickKey) {
      if (!QUICK[quickKey]) return;
      this.pushChat({ seat, name: this.seats[seat].name, text: QUICK[quickKey], quick: true });
    } else {
      const t = String(text || '').trim().slice(0, 200);
      if (!t) return;
      this.pushChat({ seat, name: this.seats[seat].name, text: t });
    }
  }
  pushChat(msg) {
    msg.ts = Date.now();
    msg.id = Math.random().toString(36).slice(2);
    this.chat.push(msg);
    if (this.chat.length > 120) this.chat.shift();
    this.changed();
  }

  changed() { if (this.onChange) this.onChange(this); }

  // ------- viste -------
  summary() {
    return {
      id: this.id,
      name: this.name,
      targetScore: this.targetScore,
      status: this.status,
      seats: this.seats.map((s) => ({ kind: s.kind, name: s.name, level: s.level, connected: s.connected })),
      open: this.seats.filter((s) => s.kind === 'open').length,
    };
  }

  viewFor(clientId) {
    const me = this.seatOf(clientId);
    const h = this.hand;
    const view = {
      id: this.id,
      name: this.name,
      targetScore: this.targetScore,
      status: this.status,
      mySeat: me,
      isHost: clientId === this.hostClient,
      hostSeat: this.hostSeat(),
      seats: this.seats.map((s) => ({
        kind: s.kind, name: s.name, connected: s.connected,
        level: s.kind === 'bot' ? s.level : null, levelLabel: s.kind === 'bot' ? LEVEL_LABEL[s.level] : null,
      })),
      scores: this.scores,
      handNo: this.handNo,
      history: this.history.slice(0, 40),
      chat: this.chat.slice(-60),
      winners: this.winners,
      nextHandAt: this.nextHandAt,
      now: Date.now(),
      quick: QUICK,
      hand: null,
    };
    if (!h) return view;
    const showPartner = h.revealed || me === h.partner;
    view.hand = {
      phase: h.phase,
      dealer: h.dealer,
      myHand: me >= 0 ? h.hands[me].map(E.cardId) : [],
      handCounts: h.hands.map((x) => x.length),
      auction: {
        turn: h.auction.turn, level: h.auction.level, bidder: h.auction.bidder, passed: h.auction.passed,
        log: h.auction.log.map((l) => ({ player: l.player, pass: !!l.pass, label: l.pass ? 'Passo' : E.levelLabel(l.level) })),
        minNext: E.minNextLevel(h),
      },
      caller: h.caller,
      level: h.level,
      levelLabel: h.level !== null ? E.levelLabel(h.level) : null,
      callRank: h.level !== null ? E.levelInfo(h.level).rank : null,
      calledCard: h.calledCard ? E.cardId(h.calledCard) : null,
      briscola: h.briscola,
      target: h.target,
      revealed: h.revealed,
      partner: showPartner ? h.partner : null,
      iAmPartner: me >= 0 && me === h.partner && me !== h.caller,
      turn: h.phase === 'auction' ? h.auction.turn : h.phase === 'call' ? h.caller : h.turn,
      trick: h.trick.map((p) => ({ player: p.player, card: E.cardId(p.card) })),
      trickNo: h.tricks.length + (h.trick.length ? 1 : 0),
      lastTrick: h.tricks.length ? (() => { const t = h.tricks[h.tricks.length - 1]; return { winner: t.winner, points: t.points, plays: t.plays.map((p) => ({ player: p.player, card: E.cardId(p.card) })), n: h.tricks.length }; })() : null,
      tricksWon: h.hands.map((_, p) => h.tricks.filter((t) => t.winner === p).length),
      result: h.result ? { ...h.result, captured: h.captured } : null,
    };
    return view;
  }
}

module.exports = { Room, QUICK, LEVEL_LABEL };
