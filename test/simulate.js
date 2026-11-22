// Simula molte mani tra bot: controlla le regole e confronta i livelli
'use strict';
const E = require('../src/engine');
const B = require('../src/bots');

function playHand(skills, dealer, rnd) {
  const h = E.newHand(dealer, rnd);
  let guard = 0;
  while (h.phase === 'auction') {
    const p = h.auction.turn;
    E.bid(h, p, B.chooseBid(h, p, skills[p], rnd));
    if (++guard > 500) throw new Error('asta infinita');
  }
  if (h.phase === 'redeal') return null;
  E.callSuit(h, h.caller, B.chooseCallSuit(h, h.caller, skills[h.caller], rnd));
  while (h.phase === 'play') {
    const p = h.turn;
    const c = B.chooseCard(h, p, skills[p], rnd);
    if (E.playCard(h, p, c)) E.resolveTrick(h);
  }
  const total = h.captured.reduce((a, b) => a + b, 0);
  if (total !== 120) throw new Error('punti totali ' + total);
  if (h.result.delta.reduce((a, b) => a + b, 0) !== 0) throw new Error('punteggio non a somma zero');
  return h;
}

function run(skills, n) {
  const score = Array(5).fill(0);
  let hands = 0, redeals = 0, solos = 0, wins = 0, pointBids = 0;
  for (let i = 0; i < n; i++) {
    const h = playHand(skills, i % 5, Math.random);
    if (!h) { redeals++; continue; }
    hands++;
    if (h.result.solo) solos++;
    if (h.result.won) wins++;
    if (h.level >= E.CARD_LEVELS) pointBids++;
    h.result.delta.forEach((d, p) => (score[p] += d));
  }
  return { score, hands, redeals, solos, wins, pointBids };
}

const N = Number(process.argv[2] || 4000);
console.log('Tutti medi', run(['medium', 'medium', 'medium', 'medium', 'medium'], N));
console.log('1 difficile vs 4 facili', run(['hard', 'easy', 'easy', 'easy', 'easy'], N));
console.log('1 medio vs 4 facili', run(['medium', 'easy', 'easy', 'easy', 'easy'], N));
console.log('1 difficile vs 4 medi', run(['hard', 'medium', 'medium', 'medium', 'medium'], N));
console.log('2 difficili vs 3 medi', run(['hard', 'medium', 'hard', 'medium', 'medium'], N));
