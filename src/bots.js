// Intelligenza dei bot: facile, medio, difficile
'use strict';
const E = require('./engine');

const CFG = { bluff: true, susp: true, lead: true, safe: true, cost: true, trumpLead: true, mc: true, samples: 30 };
const isBriscola = (h, c) => c.suit === h.briscola;

// ---------------- Valutazione mano per l'asta ----------------
const TRUMP_BONUS = { A: 7, '3': 6, K: 4, Q: 3, J: 3, '7': 2, '6': 2, '5': 2, '4': 2, '2': 2 };
function evalSuit(hand, suit) {
  let v = 0;
  for (const c of hand) {
    if (c.suit === suit) v += 3 + TRUMP_BONUS[c.rank];
    else if (c.rank === 'A') v += 3;
    else if (c.rank === '3') v += 2;
    else if (c.rank === 'K') v += 0.5;
  }
  const n = hand.filter((c) => c.suit === suit).length;
  if (n >= 4) v += (n - 3) * 2;
  return v;
}
function bestSuit(hand) {
  let best = null; let bv = -1;
  for (const s of E.SUITS) { const v = evalSuit(hand, s); if (v > bv) { bv = v; best = s; } }
  return { suit: best, value: bv };
}

// Fin dove si spinge il bot con un dato valore di seme
function maxLevelFor(value, skill) {
  if (skill === 'easy') return value < 24 ? -1 : Math.min(6, Math.floor((value - 24) / 2.5));
  let m = value < 14 ? -1 : Math.min(9, Math.floor((value - 14) / 1.3));
  if (value >= 40) m = 9 + Math.floor((value - 40) * 1.5); // asta ai punti
  return Math.min(m, E.MAX_LEVEL);
}
const SOLO_VALUE = { easy: 99, medium: 42, hard: 37 };

// Il livello L è giocabile se esiste un seme abbastanza forte in cui il bot
// NON ha la carta di quel rango (o, se ce l'ha, la mano basta per giocare da solo)
function levelOk(hand, L, skill, slack = 0) {
  const rank = E.levelInfo(L).rank;
  for (const s of E.SUITS) {
    const v = evalSuit(hand, s);
    if (maxLevelFor(v, skill) + slack < L) continue;
    const holds = hand.some((c) => c.rank === rank && c.suit === s);
    if (!holds || v >= SOLO_VALUE[skill]) return true;
  }
  return false;
}

function chooseBid(h, seat, skill, rnd = Math.random) {
  const hand = h.hands[seat];
  const next = E.minNextLevel(h);
  // il difficile ogni tanto bluffa spingendosi 1-2 livelli oltre
  const slack = (skill === 'hard' && CFG.bluff) && rnd() < 0.15 ? 1 + Math.floor(rnd() * 2) : 0;
  for (let L = next; L <= Math.min(E.MAX_LEVEL, next + 4); L++) {
    if (levelOk(hand, L, skill, slack)) {
      if ((skill === 'hard' && CFG.bluff) && L + 1 <= E.MAX_LEVEL && rnd() < 0.2 && levelOk(hand, L + 1, skill, slack)) return L + 1;
      return L;
    }
  }
  if (skill === 'easy' && next <= 3 && rnd() < 0.06) return next;
  return null;
}

function chooseCallSuit(h, seat, skill, rnd = Math.random) {
  const hand = h.hands[seat];
  const rank = E.levelInfo(h.level).rank;
  const holds = (s) => hand.some((c) => c.rank === rank && c.suit === s);
  const vals = {};
  for (const s of E.SUITS) vals[s] = evalSuit(hand, s);
  if (skill === 'easy') {
    const opts = E.SUITS.filter((s) => !holds(s));
    const pool = opts.length ? opts : E.SUITS;
    return pool.sort((a, b) => vals[b] - vals[a])[rnd() < 0.7 ? 0 : Math.floor(rnd() * pool.length)];
  }
  const bestAny = E.SUITS.slice().sort((a, b) => vals[b] - vals[a])[0];
  if (!holds(bestAny)) return bestAny;
  const free = E.SUITS.filter((s) => !holds(s)).sort((a, b) => vals[b] - vals[a]);
  const soloThr = SOLO_VALUE[skill];
  if (!free.length || vals[bestAny] >= soloThr) return bestAny; // si chiama in mano: gioca da solo
  const adequate = free.filter((s) => maxLevelFor(vals[s], skill) >= Math.min(h.level, E.CARD_LEVELS - 1));
  if (adequate.length) return adequate[0];
  if (vals[free[0]] >= vals[bestAny] - 10) return free[0];
  return bestAny;
}

// ---------------- Conoscenza delle squadre ----------------
// Punteggio di "sospetto" che un giocatore stia con il chiamante, dedotto dal gioco pubblico
function suspicion(h) {
  const score = Array(E.NPLAYERS).fill(0);
  const all = h.tricks.map((t) => t.plays).concat(h.trick.length ? [h.trick] : []);
  for (const plays of all) {
    for (let i = 1; i < plays.length; i++) {
      const prefix = plays.slice(0, i);
      const wi = E.trickWinnerIndex(prefix, h.briscola);
      const winner = prefix[wi].player;
      const me = plays[i];
      if (me.player === h.caller) continue;
      const pts = E.cardPoints(me.card);
      const beatsIt = E.beats(me.card, prefix[wi].card, prefix[0].card.suit, h.briscola);
      if (winner === h.caller) {
        if (beatsIt) score[me.player] -= 3;
        else if (pts >= 4 && !isBriscola(h, me.card)) score[me.player] += 1 + pts / 4;
        else if (pts === 0) score[me.player] += 0.2;
      } else {
        const callerPlayed = prefix.some((p) => p.player === h.caller);
        if (callerPlayed && pts >= 4 && !beatsIt) score[me.player] -= 1; // carica contro il chiamante
      }
    }
  }
  return score;
}

// relazione: 'ally' | 'enemy' | 'unknown'
function relations(h, seat, skill) {
  const rel = Array(E.NPLAYERS).fill('unknown');
  rel[seat] = 'ally';
  const iAmCaller = seat === h.caller;
  const iAmPartner = seat === h.partner; // il socio sa di esserlo: ha la carta chiamata
  const known = h.revealed || iAmPartner || (iAmCaller && h.partner === h.caller);
  if (known) {
    const team = new Set([h.caller, h.partner]);
    for (let p = 0; p < E.NPLAYERS; p++) rel[p] = team.has(p) === team.has(seat) ? 'ally' : 'enemy';
    return rel;
  }
  if (iAmCaller) {
    for (let p = 0; p < E.NPLAYERS; p++) if (p !== seat) rel[p] = 'unknown';
    if ((skill === 'hard' && CFG.susp)) {
      const s = suspicion(h);
      for (let p = 0; p < E.NPLAYERS; p++) {
        if (p === seat) continue;
        if (s[p] >= 3) rel[p] = 'ally';
        else if (s[p] <= -2) rel[p] = 'enemy';
      }
    }
    return rel;
  }
  // difensore: il chiamante è nemico, il socio è sconosciuto
  rel[h.caller] = 'enemy';
  if ((skill === 'hard' && CFG.susp)) {
    const s = suspicion(h);
    const cands = [];
    for (let p = 0; p < E.NPLAYERS; p++) if (p !== seat && p !== h.caller) cands.push(p);
    cands.sort((a, b) => s[b] - s[a]);
    if (s[cands[0]] >= 2.5 && s[cands[0]] - s[cands[1]] >= 1.5) {
      for (const p of cands) rel[p] = p === cands[0] ? 'enemy' : 'ally';
    } else {
      for (const p of cands) if (s[p] <= -2) rel[p] = 'ally';
    }
  }
  return rel;
}

// ---------------- Scelta della carta ----------------
function lowCost(h, c) { // quanto "costa" buttare questa carta
  return E.cardPoints(c) * 3 + (isBriscola(h, c) ? 25 + E.strength(c.rank) * 2 : E.strength(c.rank) * 0.3);
}
function liscio(h, hand) { return hand.slice().sort((a, b) => lowCost(h, a) - lowCost(h, b))[0]; }
function carico(h, hand) {
  const nonTrump = hand.filter((c) => !isBriscola(h, c) && E.cardPoints(c) > 0);
  if (nonTrump.length) return nonTrump.sort((a, b) => E.cardPoints(b) - E.cardPoints(a))[0];
  const trumpPts = hand.filter((c) => isBriscola(h, c) && E.cardPoints(c) > 0 && E.cardPoints(c) <= 4);
  if (trumpPts.length) return trumpPts.sort((a, b) => E.cardPoints(b) - E.cardPoints(a))[0];
  return liscio(h, hand);
}

function unseenCards(h, seat) {
  const seen = new Set(h.playedCards.map((p) => E.cardId(p.card)).concat(h.hands[seat].map(E.cardId)));
  return E.newDeck().filter((c) => !seen.has(E.cardId(c)));
}

function canStillBeBeaten(h, seat, winCard, leadSuit) {
  return unseenCards(h, seat).some((c) => E.beats(c, winCard, leadSuit, h.briscola));
}

function chooseCard(h, seat, skill, rnd = Math.random) {
  const hand = h.hands[seat];
  if (hand.length === 1) return hand[0];
  if (skill === 'easy' && rnd() < 0.7) return hand[Math.floor(rnd() * hand.length)];
  if (skill === 'hard' && CFG.mc) return monteCarloCard(h, seat, CFG.samples, rnd);
  return heuristicCard(h, seat, skill, rnd);
}

// ---------------- Monte Carlo (bot difficile) ----------------
// Il bot conosce solo la sua mano e le carte uscite: genera distribuzioni plausibili delle
// carte non viste, prova ogni carta e gioca la mano fino alla fine con la strategia media.
function cloneHand(h, hands) {
  return {
    ...h,
    hands: hands.map((x) => x.slice()),
    auction: h.auction,
    trick: h.trick.slice(),
    tricks: h.tricks.slice(),
    captured: h.captured.slice(),
    playedCards: h.playedCards.slice(),
    result: null,
  };
}

function sampleWorld(h, seat, rnd) {
  const unseen = E.shuffle(unseenCards(h, seat), rnd);
  const hands = [];
  let k = 0;
  for (let p = 0; p < E.NPLAYERS; p++) {
    if (p === seat) { hands.push(h.hands[seat].slice()); continue; }
    const n = h.hands[p].length;
    hands.push(unseen.slice(k, k + n));
    k += n;
  }
  const w = cloneHand(h, hands);
  if (!h.revealed) {
    const holder = hands.findIndex((hh) => hh.some((c) => E.sameCard(c, h.calledCard)));
    w.partner = holder >= 0 ? holder : h.partner;
  }
  return w;
}

function rollout(w, rnd) {
  while (w.phase === 'play') {
    const p = w.turn;
    const c = heuristicCard(w, p, 'medium', rnd);
    if (E.playCard(w, p, c)) E.resolveTrick(w);
  }
}

function monteCarloCard(h, seat, samples, rnd) {
  const hand = h.hands[seat];
  const totals = hand.map(() => 0);
  for (let s = 0; s < samples; s++) {
    const world = sampleWorld(h, seat, rnd);
    hand.forEach((card, i) => {
      const w = cloneHand(world, world.hands);
      w.partner = world.partner;
      if (E.playCard(w, seat, card)) E.resolveTrick(w);
      rollout(w, rnd);
      const team = new Set([w.caller, w.partner]);
      const mine = [...Array(E.NPLAYERS).keys()].filter((p) => team.has(p) === team.has(seat));
      const pts = mine.reduce((a, p) => a + w.captured[p], 0);
      totals[i] += w.result.delta[seat] * 20 + pts;
    });
  }
  let best = 0;
  for (let i = 1; i < hand.length; i++) if (totals[i] > totals[best]) best = i;
  return hand[best];
}

function heuristicCard(h, seat, skill, rnd = Math.random) {
  const s = skill === 'easy' ? 'medium' : skill;
  const rel = relations(h, seat, s);
  if (h.trick.length === 0) return lead(h, seat, s, rel, rnd);
  return follow(h, seat, s, rel);
}

function lead(h, seat, skill, rel, rnd) {
  const hand = h.hands[seat];
  const trumps = hand.filter((c) => isBriscola(h, c));
  const iAmCallerSide = rel[h.caller] === 'ally';
  // il chiamante con molte briscole tira briscola per spogliare gli avversari
  if (seat === h.caller && trumps.length >= 3 && h.tricks.length < 5) {
    const strong = trumps.filter((c) => E.strength(c.rank) >= 8);
    if (strong.length && ((skill === 'hard' && CFG.trumpLead) || rnd() < 0.6)) {
      const small = trumps.filter((c) => E.cardPoints(c) === 0).sort((a, b) => E.strength(a.rank) - E.strength(b.rank));
      return small[0] || trumps.sort((a, b) => E.strength(a.rank) - E.strength(b.rank))[0];
    }
  }
  if ((skill === 'hard' && CFG.lead)) {
    // gioca un asso o un tre non di briscola se è il più alto rimasto e le briscole sono quasi finite
    const outTrumps = unseenCards(h, seat).filter((c) => isBriscola(h, c)).length;
    if (outTrumps === 0) {
      const sure = hand.filter((c) => !isBriscola(h, c) && !canStillBeBeaten(h, seat, c, c.suit));
      if (sure.length) return sure.sort((a, b) => E.cardPoints(b) - E.cardPoints(a))[0];
    }
  }
  const nonTrump = hand.filter((c) => !isBriscola(h, c));
  const pool = nonTrump.length ? nonTrump : hand;
  // evita di aprire con carte che valgono punti
  return pool.slice().sort((a, b) => lowCost(h, a) - lowCost(h, b))[0];
}

function follow(h, seat, skill, rel) {
  const hand = h.hands[seat];
  const lead0 = h.trick[0].card;
  const wi = E.trickWinnerIndex(h.trick, h.briscola);
  const win = h.trick[wi];
  const trickPts = h.trick.reduce((s, p) => s + E.cardPoints(p.card), 0);
  const after = [];
  for (let k = 1; k < E.NPLAYERS - h.trick.length; k++) after.push((seat + k) % E.NPLAYERS);
  const relW = rel[win.player];

  if (relW === 'ally') {
    let safe = after.length === 0 || after.every((p) => rel[p] === 'ally');
    if (!safe && isBriscola(h, win.card) && E.strength(win.card.rank) >= 8) safe = true;
    if (!safe && (skill === 'hard' && CFG.safe) && !canStillBeBeaten(h, seat, win.card, lead0.suit)) safe = true;
    if (safe) return carico(h, hand);
    // l'alleato rischia: se posso blindare la presa a basso costo lo faccio
    const better = hand.filter((c) => E.beats(c, win.card, lead0.suit, h.briscola) && isBriscola(h, c) && E.strength(c.rank) >= 8 && E.cardPoints(c) <= 4);
    if (trickPts >= 10 && better.length) return better[0];
    return liscio(h, hand);
  }

  const winners = hand.filter((c) => E.beats(c, win.card, lead0.suit, h.briscola));
  if (winners.length) {
    const costOf = (c) => {
      let cost = isBriscola(h, c) ? 8 + E.strength(c.rank) + E.cardPoints(c) * 1.5 : -E.cardPoints(c) * 0.5;
      if (after.length && !isBriscola(h, c) && (skill === 'hard' && CFG.cost) && canStillBeBeaten(h, seat, c, lead0.suit)) cost += 6;
      return cost;
    };
    const cheapest = winners.slice().sort((a, b) => costOf(a) - costOf(b))[0];
    const gain = trickPts + E.cardPoints(cheapest);
    const threshold = relW === 'enemy' ? (isBriscola(h, cheapest) ? (E.strength(cheapest.rank) >= 9 ? 10 : 3) : 0) : (isBriscola(h, cheapest) ? 11 : 4);
    if (gain >= threshold && !(gain === 0 && isBriscola(h, cheapest))) return cheapest;
    if (!isBriscola(h, cheapest) && after.length === 0) return cheapest;
  }
  return liscio(h, hand);
}

module.exports = { CFG, chooseBid, chooseCallSuit, chooseCard, evalSuit, relations, suspicion };
