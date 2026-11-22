// Misura il vantaggio medio per mano di un livello contro un altro (posto ruotato)
'use strict';
const E = require('../src/engine');
const B = require('../src/bots');

function bench(hero, villain, N) {
  let sum = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const seatHero = i % 5;
    const sk = Array(5).fill(villain); sk[seatHero] = hero;
    const h = E.newHand(Math.floor(i / 5) % 5);
    while (h.phase === 'auction') { const p = h.auction.turn; E.bid(h, p, B.chooseBid(h, p, sk[p])); }
    if (h.phase === 'redeal') continue;
    E.callSuit(h, h.caller, B.chooseCallSuit(h, h.caller, sk[h.caller]));
    while (h.phase === 'play') { const p = h.turn; if (E.playCard(h, p, B.chooseCard(h, p, sk[p]))) E.resolveTrick(h); }
    sum += h.result.delta[seatHero]; n++;
  }
  return (sum / n).toFixed(3);
}
const N = Number(process.argv[2] || 20000);
console.log('difficile vs medi:', bench('hard', 'medium', N));
console.log('medio vs facili:  ', bench('medium', 'easy', N));
console.log('difficile vs facili:', bench('hard', 'easy', N));
