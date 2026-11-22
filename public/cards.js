// Disegno delle carte francesi (40 carte: A, 2–7, J, Q, K)
(function () {
  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'Picche', H: 'Cuori', D: 'Quadri', C: 'Fiori' };
  const RANK_NAME = { A: 'Asso', 2: 'Due', 3: 'Tre', 4: 'Quattro', 5: 'Cinque', 6: 'Sei', 7: 'Sette', J: 'Fante', Q: 'Donna', K: 'Re' };
  const ORDER = ['A', '3', 'K', 'Q', 'J', '7', '6', '5', '4', '2'];
  const POINTS = { A: 11, 3: 10, K: 4, Q: 3, J: 2 };

  // disposizione dei simboli per le carte numeriche (griglia 3 colonne x 5 righe)
  const PIPS = {
    2: [[1, 0], [1, 4]],
    3: [[1, 0], [1, 2], [1, 4]],
    4: [[0, 0], [2, 0], [0, 4], [2, 4]],
    5: [[0, 0], [2, 0], [1, 2], [0, 4], [2, 4]],
    6: [[0, 0], [2, 0], [0, 2], [2, 2], [0, 4], [2, 4]],
    7: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4]],
  };

  const parse = (id) => ({ rank: id.slice(0, -1), suit: id.slice(-1) });
  const isRed = (s) => s === 'H' || s === 'D';

  function center(rank, suit) {
    const s = SYM[suit];
    if (rank === 'A') return `<div class="c-ace">${s}</div>`;
    if (PIPS[rank]) {
      return `<div class="c-pips">${PIPS[rank].map(([x, y]) => `<span style="--x:${x};--y:${y}" class="${y > 2 ? 'flip' : ''}">${s}</span>`).join('')}</div>`;
    }
    return `<div class="c-face"><span class="c-face-l">${rank}</span><span class="c-face-s">${s}</span></div>`;
  }

  function html(id, extra = '') {
    if (!id) return `<div class="card back ${extra}" aria-hidden="true"></div>`;
    const { rank, suit } = parse(id);
    const label = `${RANK_NAME[rank]} di ${SUIT_NAME[suit]}`;
    return `<div class="card ${isRed(suit) ? 'red' : 'black'} ${extra}" data-id="${id}" aria-label="${label}" title="${label}">
      <div class="c-idx tl"><b>${rank}</b><i>${SYM[suit]}</i></div>
      ${center(rank, suit)}
      <div class="c-idx br"><b>${rank}</b><i>${SYM[suit]}</i></div>
    </div>`;
  }

  window.Cards = { html, parse, SYM, SUIT_NAME, RANK_NAME, ORDER, POINTS, isRed,
    name: (id) => { const { rank, suit } = parse(id); return `${RANK_NAME[rank]} di ${SUIT_NAME[suit]}`; } };
})();
