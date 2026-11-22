// Motore di gioco della Briscola Chiamata (5 giocatori, mazzo francese da 40 carte)
'use strict';

const SUITS = ['S', 'H', 'D', 'C']; // Picche, Cuori, Quadri, Fiori
const RANKS = ['A', '3', 'K', 'Q', 'J', '7', '6', '5', '4', '2']; // dalla più forte alla più debole
const POINTS = { A: 11, '3': 10, K: 4, Q: 3, J: 2, '7': 0, '6': 0, '5': 0, '4': 0, '2': 0 };
const NPLAYERS = 5;
const CARD_LEVELS = RANKS.length; // livelli 0..9 = chiamata di carta (Asso..2)
const MAX_LEVEL = CARD_LEVELS - 1 + (120 - 61); // livello massimo = "2 a 120"

const SUIT_NAMES = { S: 'Picche', H: 'Cuori', D: 'Quadri', C: 'Fiori' };
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_NAMES = { A: 'Asso', '3': 'Tre', K: 'Re', Q: 'Donna', J: 'Fante', '7': 'Sette', '6': 'Sei', '5': 'Cinque', '4': 'Quattro', '2': 'Due' };

const strength = (rank) => CARD_LEVELS - RANKS.indexOf(rank); // A=10 ... 2=1
const cardId = (c) => c.rank + c.suit;
const parseCard = (id) => ({ rank: id.slice(0, -1), suit: id.slice(-1) });
const sameCard = (a, b) => a && b && a.rank === b.rank && a.suit === b.suit;
const cardPoints = (c) => POINTS[c.rank];

function levelInfo(level) {
  if (level < CARD_LEVELS) return { rank: RANKS[level], target: 61 };
  return { rank: '2', target: 61 + (level - (CARD_LEVELS - 1)) };
}
function levelLabel(level) {
  const { rank, target } = levelInfo(level);
  if (level < CARD_LEVELS) return RANK_NAMES[rank];
  return `Due a ${target}`;
}
function cardName(c) { return `${RANK_NAMES[c.rank]} di ${SUIT_NAMES[c.suit]}`; }

function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}
function shuffle(arr, rnd = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sortHand(hand) {
  const order = { S: 0, H: 1, C: 2, D: 3 };
  return hand.sort((a, b) => order[a.suit] - order[b.suit] || strength(b.rank) - strength(a.rank));
}

// Chi vince una presa (giocate in ordine). briscola = seme di briscola.
function trickWinnerIndex(plays, briscola) {
  let best = 0;
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i].card, plays[best].card, plays[0].card.suit, briscola)) best = i;
  }
  return best;
}
function beats(a, b, leadSuit, briscola) {
  if (a.suit === b.suit) return strength(a.rank) > strength(b.rank);
  if (a.suit === briscola) return true;
  if (b.suit === briscola) return false;
  return false; // a non è del seme di b e non è briscola
}

// Stato di una mano
function newHand(dealer, rnd = Math.random) {
  const deck = shuffle(newDeck(), rnd);
  const hands = [];
  for (let p = 0; p < NPLAYERS; p++) hands.push(sortHand(deck.slice(p * 8, p * 8 + 8)));
  const first = (dealer + 1) % NPLAYERS;
  return {
    phase: 'auction', // auction -> call -> play -> done
    dealer,
    hands,
    initialHands: hands.map((h) => h.slice()),
    auction: { turn: first, level: null, bidder: null, passed: Array(NPLAYERS).fill(false), log: [] },
    caller: null,
    level: null,
    calledCard: null,
    briscola: null,
    target: null,
    partner: null,
    revealed: false,
    turn: null,
    trick: [],
    leader: null,
    tricks: [], // {plays, winner, points}
    captured: Array(NPLAYERS).fill(0),
    playedCards: [],
    result: null,
  };
}

function minNextLevel(h) { return h.auction.level === null ? 0 : h.auction.level + 1; }

function bid(h, player, level) { // level === null => passo
  if (h.phase !== 'auction') throw new Error('Non è il momento dell\'asta');
  const a = h.auction;
  if (a.turn !== player) throw new Error('Non è il tuo turno');
  if (level === null) {
    a.passed[player] = true;
    a.log.push({ player, pass: true });
  } else {
    if (!Number.isInteger(level) || level < minNextLevel(h) || level > MAX_LEVEL) throw new Error('Puntata non valida');
    a.level = level;
    a.bidder = player;
    a.log.push({ player, level });
  }
  const active = [];
  for (let p = 0; p < NPLAYERS; p++) if (!a.passed[p]) active.push(p);
  if (active.length === 0) { h.phase = 'redeal'; return; }
  if (active.length === 1 && a.bidder === active[0]) { finishAuction(h); return; }
  if (a.level === MAX_LEVEL) { finishAuction(h); return; }
  // turno al prossimo non passato
  let t = player;
  do { t = (t + 1) % NPLAYERS; } while (a.passed[t]);
  a.turn = t;
}
function finishAuction(h) {
  h.caller = h.auction.bidder;
  h.level = h.auction.level;
  h.target = levelInfo(h.level).target;
  h.phase = 'call';
  h.turn = h.caller;
}

function callSuit(h, player, suit) {
  if (h.phase !== 'call') throw new Error('Non è il momento di chiamare');
  if (player !== h.caller) throw new Error('Non sei il chiamante');
  if (!SUITS.includes(suit)) throw new Error('Seme non valido');
  h.calledCard = { rank: levelInfo(h.level).rank, suit };
  h.briscola = suit;
  h.partner = h.hands.findIndex((hand) => hand.some((c) => sameCard(c, h.calledCard)));
  h.phase = 'play';
  h.leader = (h.dealer + 1) % NPLAYERS;
  h.turn = h.leader;
}

// Gioca una carta. Ritorna true se la presa è completa (5 carte).
function playCard(h, player, card) {
  if (h.phase !== 'play') throw new Error('Non si gioca adesso');
  if (h.turn !== player) throw new Error('Non è il tuo turno');
  if (h.trick.length >= NPLAYERS) throw new Error('Presa in chiusura');
  const idx = h.hands[player].findIndex((c) => sameCard(c, card));
  if (idx < 0) throw new Error('Carta non in mano');
  const [c] = h.hands[player].splice(idx, 1);
  h.trick.push({ player, card: c });
  h.playedCards.push({ player, card: c });
  if (sameCard(c, h.calledCard)) h.revealed = true;
  if (h.trick.length === NPLAYERS) { h.turn = null; return true; }
  h.turn = (player + 1) % NPLAYERS;
  return false;
}

function resolveTrick(h) {
  const wi = trickWinnerIndex(h.trick, h.briscola);
  const winner = h.trick[wi].player;
  const points = h.trick.reduce((s, p) => s + cardPoints(p.card), 0);
  h.captured[winner] += points;
  h.tricks.push({ plays: h.trick, winner, points });
  h.trick = [];
  if (h.tricks.length === 8) { finishHand(h); return winner; }
  h.leader = winner;
  h.turn = winner;
  return winner;
}

function callerTeam(h) {
  const t = new Set([h.caller, h.partner]);
  return [...t];
}

function finishHand(h) {
  const team = callerTeam(h);
  const solo = h.partner === h.caller;
  const teamPoints = team.reduce((s, p) => s + h.captured[p], 0);
  const won = teamPoints >= h.target;
  const cappotto = teamPoints === 120 || teamPoints === 0;
  const mult = (won ? 1 : -1) * (cappotto ? 2 : 1);
  const delta = Array(NPLAYERS).fill(0);
  for (let p = 0; p < NPLAYERS; p++) {
    if (p === h.caller) delta[p] = (solo ? 4 : 2) * mult;
    else if (p === h.partner) delta[p] = 1 * mult;
    else delta[p] = -1 * mult;
  }
  h.phase = 'done';
  h.revealed = true;
  h.turn = null;
  h.result = { team, solo, teamPoints, defenderPoints: 120 - teamPoints, target: h.target, won, cappotto, delta };
}

module.exports = {
  SUITS, RANKS, POINTS, NPLAYERS, CARD_LEVELS, MAX_LEVEL, SUIT_NAMES, SUIT_SYMBOLS, RANK_NAMES,
  strength, cardId, parseCard, sameCard, cardPoints, levelInfo, levelLabel, cardName,
  newDeck, shuffle, sortHand, trickWinnerIndex, beats,
  newHand, minNextLevel, bid, callSuit, playCard, resolveTrick, callerTeam,
};
