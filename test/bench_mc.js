const B=require('../src/bots');const E=require('../src/engine');
function bench(N,hero='hard',vil='medium'){let sum=0,n=0;for(let i=0;i<N;i++){const sh=i%5;const sk=Array(5).fill(vil);sk[sh]=hero;const h=E.newHand(Math.floor(i/5)%5);
while(h.phase==='auction'){const p=h.auction.turn;E.bid(h,p,B.chooseBid(h,p,sk[p]));}if(h.phase==='redeal')continue;
E.callSuit(h,h.caller,B.chooseCallSuit(h,h.caller,sk[h.caller]));while(h.phase==='play'){const p=h.turn;if(E.playCard(h,p,B.chooseCard(h,p,sk[p])))E.resolveTrick(h);}sum+=h.result.delta[sh];n++;}return (sum/n).toFixed(3);}
const N=+process.argv[2]||1000;B.CFG.samples=+process.argv[3]||30;
const t=Date.now();console.log('MC difficile vs medi',bench(N),'ms/mano',(Date.now()-t)/N);
