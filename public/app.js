/* Briscola Chiamata — client */
(function () {
  'use strict';
  const C = window.Cards;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* niente */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* niente */ } },
  };
  let clientId = store.get('bc_client');
  if (!clientId) { clientId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('bc_client', clientId); }

  const app = $('#app');
  const LEVELS = ['A', '3', 'K', 'Q', 'J', '7', '6', '5', '4', '2'];
  const SUITS = ['S', 'H', 'D', 'C'];
  const LEVEL_NAMES = { easy: 'facile', medium: 'medio', hard: 'difficile' };

  const S = {
    screen: 'login',
    name: store.get('bc_name') || '',
    password: store.get('bc_pw') || '',
    lobby: [],
    room: null,
    clockOffset: 0,
    loginError: '',
    create: { name: '', target: 10, seats: ['medium', 'medium', 'medium', 'medium'] },
    drawer: null, // 'score' | 'chat'
    quickOpen: false,
    points: 62,
    seenChat: new Set(),
    chatInit: false,
    unread: 0,
    bubbles: {}, // seat -> {text, until}
    resultHidden: null,
    gameBuilt: false,
  };
  let socket = null;

  // ------------------------------------------------------------ connessione
  function connect() {
    if (socket) socket.disconnect();
    socket = io({ auth: { password: S.password }, reconnectionDelayMax: 4000 });
    socket.on('connect_error', (err) => {
      if (err && err.message === 'password') {
        S.loginError = 'Password non corretta';
        S.screen = 'login';
        socket.disconnect();
        render();
      }
    });
    socket.on('connect', () => {
      store.set('bc_pw', S.password);
      socket.emit('hello', { clientId, name: S.name }, () => {
        const last = store.get('bc_room');
        if (last) {
          socket.emit('joinRoom', { roomId: last }, (r) => { if (!r.ok) { store.del('bc_room'); goLobby(); } });
        } else goLobby();
      });
    });
    socket.on('disconnect', () => toast('Connessione persa, riprovo…'));
    socket.on('lobby', (list) => { S.lobby = list; if (S.screen === 'lobby') renderTables(); });
    socket.on('room', (room) => {
      if (!room) { S.room = null; store.del('bc_room'); goLobby(); return; }
      const prev = S.room;
      S.room = room;
      S.clockOffset = room.now - Date.now();
      store.set('bc_room', room.id);
      onChatUpdate(room);
      const screen = room.status === 'lobby' ? 'waiting' : 'game';
      if (S.screen !== screen) { S.screen = screen; S.gameBuilt = false; render(); } else if (screen === 'game') updateGame(prev); else render();
    });
    socket.on('errorMsg', toast);
  }
  function goLobby() { S.screen = 'lobby'; S.gameBuilt = false; S.drawer = null; render(); }
  function emit(ev, data, cb) {
    socket.emit(ev, data || {}, (res) => { if (res && !res.ok) toast(res.error); if (cb) cb(res); });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ------------------------------------------------------------ render principale
  function render() {
    if (S.screen === 'login') return renderLogin();
    if (S.screen === 'lobby') return renderLobby();
    if (S.screen === 'waiting') return renderWaiting();
    if (S.screen === 'game') return buildGame();
  }

  function brand(sub) {
    return `<div class="brand"><div class="suits" aria-hidden="true">♠<span class="r">♥</span>♣<span class="r">♦</span></div><h1>Briscola Chiamata</h1><p>${sub}</p></div>`;
  }

  function renderLogin() {
    app.innerHTML = `<main class="screen"><div class="panel">
      ${brand('cinque al tavolo, uno chiama, uno è il socio')}
      <form id="login">
        <label class="field"><span>Il tuo nome</span><input class="input" name="name" maxlength="16" autocomplete="nickname" required value="${esc(S.name)}"></label>
        <label class="field"><span>Password del tavolo</span><input class="input" name="pw" type="password" required value="${esc(S.password)}"></label>
        <div class="err">${esc(S.loginError)}</div>
        <button class="btn gold" type="submit">Entra</button>
      </form></div></main>`;
    $('#login').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      S.name = f.name.value.trim().slice(0, 16);
      S.password = f.pw.value;
      if (!S.name) return;
      store.set('bc_name', S.name);
      S.loginError = '';
      connect();
    });
  }

  function seg(options, value, attr) {
    return `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-${attr}="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
  }
  const SEAT_OPTS = [['open', 'Amico'], ['easy', 'Bot facile'], ['medium', 'Bot medio'], ['hard', 'Bot difficile']];
  const TARGETS = [5, 10, 15, 20, 25, 30].map((t) => [t, t]);

  function renderLobby() {
    app.innerHTML = `<main class="screen"><div class="panel">
      <div class="lobby-head"><h2>Tavoli</h2><span class="me-chip">Sei <b>${esc(S.name)}</b> <button class="btn ghost small" id="rename">Cambia</button></span></div>
      <div class="tables" id="tables"></div>
      <form class="create" id="create">
        <h3>Apri un tavolo</h3>
        <label class="field"><span>Nome del tavolo</span><input class="input" name="tname" maxlength="30" placeholder="Il tavolo di ${esc(S.name)}" value="${esc(S.create.name)}"></label>
        <div class="field"><span><b>Si vince a</b></span>${seg(TARGETS, S.create.target, 'target')}</div>
        <div class="field"><b>Gli altri quattro posti</b>
          <div class="seat-cfg">${S.create.seats.map((k, i) => `<div class="row"><span>Posto ${i + 2}</span>${seg(SEAT_OPTS, k, `seat${i}`)}</div>`).join('')}</div>
        </div>
        <button class="btn gold" type="submit">Apri il tavolo</button>
      </form></div></main>`;
    renderTables();
    const f = $('#create');
    f.tname.addEventListener('input', (e) => { S.create.name = e.target.value; });
    f.addEventListener('click', (e) => {
      const b = e.target.closest('button[type=button]');
      if (!b) return;
      if (b.dataset.target) S.create.target = Number(b.dataset.target);
      for (let i = 0; i < 4; i++) if (b.dataset[`seat${i}`]) S.create.seats[i] = b.dataset[`seat${i}`];
      renderLobby();
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      emit('createRoom', { name: S.create.name.trim() || `Il tavolo di ${S.name}`, targetScore: S.create.target, seats: S.create.seats });
    });
    $('#rename').addEventListener('click', () => { S.screen = 'login'; if (socket) socket.disconnect(); render(); });
  }

  function renderTables() {
    const box = $('#tables');
    if (!box) return;
    if (!S.lobby.length) { box.innerHTML = '<div class="empty">Nessun tavolo aperto. Aprine uno qui sotto e gli altri lo vedranno comparire.</div>'; return; }
    box.innerHTML = S.lobby.map((r) => {
      const people = r.seats.filter((s) => s.kind === 'human').map((s) => s.name);
      const bots = r.seats.filter((s) => s.kind === 'bot').length;
      const line = [people.length ? people.map(esc).join(', ') : 'nessuno', bots ? `${bots} bot` : '', r.open ? `${r.open} posti liberi` : ''].filter(Boolean).join(', ');
      const playing = r.status !== 'lobby';
      const btn = playing ? '<button class="btn ghost small" data-join="1">Rientra</button>' : (r.open ? '<button class="btn small" data-join="1">Siediti</button>' : '<span class="me-chip">Pieno</span>');
      return `<div class="table-row ${playing ? 'playing' : ''}" data-id="${r.id}"><div class="info"><b>${esc(r.name)}</b><small>${playing ? 'In corso' : 'In attesa'}, si vince a ${r.targetScore}. ${line}</small></div>${btn}</div>`;
    }).join('');
    box.onclick = (e) => {
      const b = e.target.closest('[data-join]');
      if (!b) return;
      emit('joinRoom', { roomId: b.closest('.table-row').dataset.id });
    };
  }

  // ------------------------------------------------------------ sala d'attesa
  function renderWaiting() {
    const r = S.room;
    const host = r.hostSeat >= 0 ? r.seats[r.hostSeat].name : '';
    app.innerHTML = `<main class="screen"><div class="panel">
      <div class="lobby-head"><h2>${esc(r.name)}</h2><button class="btn ghost small" id="leave">Esci</button></div>
      <div class="field"><b>Si vince a</b> ${r.isHost ? seg(TARGETS, r.targetScore, 'target') : `<span>${r.targetScore} punti</span>`}</div>
      <div class="wait-seats">${r.seats.map((s, i) => {
        const av = s.kind === 'human' ? `<div class="avatar">${esc(s.name[0].toUpperCase())}</div>` : s.kind === 'bot' ? '<div class="avatar bot" aria-hidden="true">🤖</div>' : '<div class="avatar open">?</div>';
        const who = s.kind === 'human' ? `<b>${esc(s.name)}</b><small>${i === r.hostSeat ? 'ha aperto il tavolo' : 'giocatore'}${i === r.mySeat ? ', sei tu' : ''}</small>` :
          s.kind === 'bot' ? `<b>${esc(s.name)}</b><small>bot ${s.levelLabel}</small>` : '<b>Posto libero</b><small>in attesa di un amico</small>';
        const cfg = r.isHost && s.kind !== 'human' ? seg([['open', 'Libero'], ['easy', 'Facile'], ['medium', 'Medio'], ['hard', 'Difficile']], s.kind === 'bot' ? s.level : 'open', `cfg${i}`) : '';
        return `<div class="wait-seat"><div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">${av}<div class="who">${who}</div></div>${cfg}</div>`;
      }).join('')}</div>
      ${r.isHost ? `<button class="btn gold" id="start">Inizia la partita</button><p class="me-chip">I posti ancora liberi verranno presi da bot medi.</p>` : `<p class="me-chip">Aspettiamo che ${esc(host)} avvii la partita.</p>`}
    </div></main>`;
    $('#leave').addEventListener('click', () => emit('leaveRoom'));
    if (r.isHost) {
      $('#start').addEventListener('click', () => emit('start'));
      app.querySelector('.panel').addEventListener('click', (e) => {
        const b = e.target.closest('button[type=button]');
        if (!b) return;
        if (b.dataset.target) emit('target', { target: Number(b.dataset.target) });
        for (let i = 0; i < 5; i++) if (b.dataset[`cfg${i}`]) emit('seat', { seat: i, kind: b.dataset[`cfg${i}`] });
      });
    }
  }

  // ------------------------------------------------------------ tavolo di gioco
  const POS = [ // posizione dei giocatori sul panno, relativa a me (0 = io, poi verso destra)
    null,
    { left: 'min(calc(100% - 56px), 90%)', top: '56%' },
    { left: '73%', top: '13%' },
    { left: '27%', top: '13%' },
    { left: 'max(56px, 10%)', top: '56%' },
  ];
  const TRICK_OFF = [[0, 46], [62, 8], [36, -42], [-36, -42], [-62, 8]];
  const TRICK_ROT = [0, 8, -5, 5, -8];
  const rel = (seat) => (seat - S.room.mySeat + 5) % 5;
  const trickScale = () => (window.innerWidth >= 720 ? 1.35 : 1);

  function buildGame() {
    const wide = window.matchMedia('(min-width: 1100px)').matches;
    app.innerHTML = `<div class="game ${wide ? 'with-chat' : ''}">
      <header class="topbar">
        <button class="icon-btn" id="exit" aria-label="Esci dal tavolo">←</button>
        <div class="title" id="title"></div>
        <button class="icon-btn" id="openScore" aria-label="Punti e storico">📋 <span>Punti</span></button>
        ${wide ? '' : '<button class="icon-btn" id="openChat" aria-label="Chat">💬<span class="badge" id="unread" hidden></span></button>'}
      </header>
      <div class="reminder" id="reminder"></div>
      <div class="felt-wrap"><div class="felt" id="felt">
        <div id="seats"></div>
        <div class="center-msg" id="centerMsg"></div>
        <div class="trick-area" id="trick"></div>
        <div class="trick-info" id="trickInfo"></div>
      </div></div>
      <div class="bottom">
        <div id="action"></div>
        <div class="me-row" id="meRow"></div>
        <div class="hand" id="hand"></div>
      </div>
      ${wide ? `<aside class="side-chat"><h2>Chat</h2>${chatInner()}</aside>` : ''}
    </div>
    <div id="overlay"></div><div id="drawer"></div>`;
    S.gameBuilt = true;
    S.trickEls = new Map();
    $('#exit').addEventListener('click', () => {
      if (confirm('Vuoi lasciare il tavolo? Al tuo posto giocherà un bot finché non rientri.')) emit('leaveRoom');
    });
    $('#openScore').addEventListener('click', () => openDrawer('score'));
    if (!wide) $('#openChat').addEventListener('click', () => openDrawer('chat'));
    else bindChat(app.querySelector('.side-chat'));
    $('#hand').addEventListener('click', onHandClick);
    $('#action').addEventListener('click', onActionClick);
    $('#meRow').addEventListener('click', onMeRowClick);
    updateGame(null);
  }

  function updateGame(prev) {
    if (!S.gameBuilt) return buildGame();
    const r = S.room;
    const h = r.hand;
    $('#title').innerHTML = `${esc(r.name)}<small>mano ${r.handNo}, si vince a ${r.targetScore}</small>`;
    renderReminder(r, h);
    renderSeats(r, h);
    renderTrick(r, h, prev);
    renderCenter(r, h);
    renderAction(r, h);
    renderMe(r, h);
    renderHand(r, h);
    renderOverlay(r, h);
    if (S.drawer) renderDrawerBody();
    renderChatLogs();
  }

  function teamOf(h, seat) {
    if (!h || h.partner === null || h.partner === undefined || h.caller === null) return null;
    return seat === h.caller || seat === h.partner ? 'caller' : 'def';
  }

  function renderReminder(r, h) {
    const el = $('#reminder');
    if (!h) { el.innerHTML = ''; return; }
    const nm = (i) => esc(r.seats[i].name);
    let html = '';
    if (h.phase === 'auction') {
      html = `<div class="txt"><b>Asta</b><small>${h.auction.level === null ? 'Ancora nessuna puntata' : `Punta più alta: ${esc(h.auction.log.filter((l) => !l.pass).slice(-1)[0].label)} di ${nm(h.auction.bidder)}`}</small></div>`;
    } else if (h.phase === 'call') {
      html = `<div class="txt"><b>${nm(h.caller)} ha vinto l'asta</b><small>Chiama ${esc(h.levelLabel)}, ora sceglie il seme</small></div>`;
    } else if (h.phase === 'redeal') {
      html = '<div class="txt"><b>Tutti hanno passato</b><small>Si rimescola</small></div>';
    } else if (h.calledCard) {
      const partnerTxt = h.revealed ? (h.partner === h.caller ? `${nm(h.caller)} gioca da solo` : `Socio: ${nm(h.partner)}`) : 'Socio ancora nascosto';
      html = `<div class="mini">${C.html(h.calledCard)}</div>
        <div class="txt"><b>${esc(C.name(h.calledCard))}</b><small>Briscola ${C.SUIT_NAME[h.briscola]} ${C.SYM[h.briscola]}. Chiama ${nm(h.caller)}, servono ${h.target}. ${partnerTxt}</small></div>
        ${h.iAmPartner && !h.revealed ? '<div class="secret">Il socio sei tu!<br>Acqua in bocca</div>' : ''}`;
    }
    el.innerHTML = html;
  }

  function lastBid(h, seat) {
    const l = h.auction.log.filter((x) => x.player === seat).slice(-1)[0];
    return l || null;
  }

  function seatInner(r, h, i) {
    const s = r.seats[i];
    const av = s.kind === 'bot' ? '🤖' : esc((s.name || '?')[0].toUpperCase());
    const meta = [];
    if (h && h.dealer === i) meta.push('<span class="dealer-chip" title="Mazziere">M</span>');
    if (h && h.caller === i && h.phase !== 'auction') meta.push('<span class="crown" title="Chiamante">♛</span>');
    if (h && (h.phase === 'play' || h.phase === 'done')) meta.push(`<span title="Prese fatte">${h.tricksWon[i]} ${h.tricksWon[i] === 1 ? 'presa' : 'prese'}</span>`);
    if (s.kind === 'bot' && !(h && (h.phase === 'play' || h.phase === 'done'))) meta.push(`<span>bot ${s.levelLabel}</span>`);
    if (s.kind === 'human' && !s.connected) meta.push('<span>fuori, gioca un bot</span>');
    let tag = '';
    if (h && h.phase === 'auction') {
      const lb = lastBid(h, i);
      if (lb) tag = `<span class="bid-tag ${lb.pass ? 'pass' : ''}">${esc(lb.label)}</span>`;
    }
    const bub = S.bubbles[i] && S.bubbles[i].until > Date.now() ? `<div class="bubble">${esc(S.bubbles[i].text)}</div>` : '';
    return { av, meta: meta.join(''), tag, bub };
  }

  function renderSeats(r, h) {
    const box = $('#seats');
    let html = '';
    for (let i = 0; i < 5; i++) {
      const k = rel(i);
      if (k === 0) continue;
      const s = r.seats[i];
      const { av, meta, tag, bub } = seatInner(r, h, i);
      const team = teamOf(h, i);
      const cls = ['seat', h && h.turn === i && h.phase !== 'done' ? 'turn' : '', team ? `team-${team}` : '', s.kind === 'human' && !s.connected ? 'away' : ''].join(' ');
      const backs = h ? `<div class="backs">${Array.from({ length: h.handCounts[i] }, () => C.html(null)).join('')}</div>` : '';
      html += `<div class="${cls}" data-seat="${i}" style="left:${POS[k].left};top:${POS[k].top}">
        ${bub}<div class="plate"><div class="avatar ${s.kind === 'bot' ? 'bot' : ''}">${av}</div><span class="nm">${esc(s.name)}</span></div>
        <div class="meta">${meta}</div>${tag || backs}</div>`;
    }
    box.innerHTML = html;
  }

  function seatPoint(seat) { // centro del posto rispetto al centro del panno
    const area = $('#trick').getBoundingClientRect();
    if (rel(seat) === 0) {
      const hand = $('#hand').getBoundingClientRect();
      return { x: hand.left + hand.width / 2 - area.left, y: hand.top + 20 - area.top };
    }
    const el = $(`#seats [data-seat="${seat}"] .plate`);
    if (!el) return { x: 0, y: 0 };
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2 - area.left, y: b.top + b.height / 2 - area.top };
  }
  const place = (el, x, y, rot, scale = 1) => { el.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rot}deg) scale(${scale})`; };

  function winnerIdx(trick, briscola) {
    const str = (r) => 10 - LEVELS.indexOf(r);
    let best = 0;
    for (let i = 1; i < trick.length; i++) {
      const a = C.parse(trick[i].card); const b = C.parse(trick[best].card);
      if (a.suit === b.suit ? str(a.rank) > str(b.rank) : a.suit === briscola) best = i;
    }
    return best;
  }

  function renderTrick(r, h, prev) {
    const area = $('#trick');
    const els = S.trickEls;
    const live = new Set();
    if (h && (h.phase === 'play' || h.phase === 'done')) {
      const tn = h.trick.length ? h.trickNo : null;
      h.trick.forEach((p) => {
        const key = `${r.handNo}:${tn}:${p.player}`;
        live.add(key);
        if (els.has(key)) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = C.html(p.card);
        const el = wrap.firstElementChild;
        const from = S.lastPlayedFrom && p.player === r.mySeat ? S.lastPlayedFrom : seatPoint(p.player);
        place(el, from.x, from.y, 0, 0.8);
        area.appendChild(el);
        el.getBoundingClientRect();
        const k = rel(p.player); const sc = trickScale();
        place(el, TRICK_OFF[k][0] * sc, TRICK_OFF[k][1] * sc, TRICK_ROT[k]);
        el.style.zIndex = String(h.trick.indexOf(p) + 1);
        els.set(key, el);
      });
      S.lastPlayedFrom = null;
      if (h.trick.length === 5) {
        const wi = winnerIdx(h.trick, h.briscola);
        const el = els.get(`${r.handNo}:${tn}:${h.trick[wi].player}`);
        if (el) el.classList.add('win');
      }
    }
    for (const [key, el] of els) {
      if (live.has(key)) continue;
      els.delete(key);
      const lt = h && h.lastTrick;
      const [hn, tn] = key.split(':');
      if (lt && Number(hn) === r.handNo && Number(tn) === lt.n) {
        const to = seatPoint(lt.winner);
        place(el, to.x, to.y, 0, 0.35);
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 480);
      } else el.remove();
    }
    const info = $('#trickInfo');
    info.textContent = h && h.phase === 'play' ? `presa ${Math.min(h.trickNo || 1, 8)} di 8` : '';
  }

  function renderCenter(r, h) {
    const el = $('#centerMsg');
    let t = '';
    if (!h) t = '';
    else if (h.phase === 'auction' && h.turn !== r.mySeat) t = `Asta: tocca a ${esc(r.seats[h.turn].name)}`;
    else if (h.phase === 'call' && h.caller !== r.mySeat) t = `${esc(r.seats[h.caller].name)} sceglie il seme…`;
    else if (h.phase === 'redeal') t = 'Tutti passano, si rimescola';
    el.innerHTML = t;
  }

  function renderAction(r, h) {
    const el = $('#action');
    if (!h || r.mySeat < 0) { el.innerHTML = ''; return; }
    if (h.phase === 'auction' && h.turn === r.mySeat) {
      const min = h.auction.minNext;
      const cards = [];
      for (let L = min; L <= 9; L++) cards.push(`<button data-bid="${L}">${C.RANK_NAME[LEVELS[L]]}</button>`);
      const minPts = Math.max(62, min - 9 + 61);
      if (S.points < minPts || S.points > 120) S.points = minPts;
      const cur = h.auction.level === null ? 'Nessuno ha ancora puntato: apri l\'asta o passa.' : `Per ora vince ${esc(r.seats[h.auction.bidder].name)} con ${esc(h.auction.log.filter((l) => !l.pass).slice(-1)[0].label)}. Scendi di carta o passa.`;
      el.innerHTML = `<div class="action"><h3>Tocca a te nell'asta</h3><p>${cur}</p>
        <div class="bids">${cards.join('')}<button class="pass" data-bid="pass">Passo</button></div>
        ${minPts <= 120 ? `<div class="points"><span>Oppure il Due a</span><button class="step" data-pts="-1" aria-label="Meno punti">−</button><span class="val">${S.points}</span><button class="step" data-pts="1" aria-label="Più punti">+</button><button class="btn small" data-bid="${S.points - 61 + 9}">Punta</button></div>` : ''}
      </div>`;
      return;
    }
    if (h.phase === 'call' && h.caller === r.mySeat) {
      const rank = h.callRank;
      el.innerHTML = `<div class="action"><h3>Hai vinto l'asta: scegli il seme del ${C.RANK_NAME[rank]}</h3><p>Il seme che scegli diventa briscola. Servono ${h.target} punti.</p>
        <div class="suits-pick">${SUITS.map((s) => {
          const mine = h.myHand.includes(rank + s);
          return `<button data-suit="${s}" class="${C.isRed(s) ? 'red' : ''} ${mine ? 'solo' : ''}"><span class="s">${C.SYM[s]}</span>${C.SUIT_NAME[s]}<small>${mine ? 'ce l\'hai: da solo' : `${rank} di ${C.SUIT_NAME[s]}`}</small></button>`;
        }).join('')}</div></div>`;
      return;
    }
    el.innerHTML = '';
  }

  function onActionClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pts) { S.points = Math.min(120, Math.max(62, S.points + Number(b.dataset.pts))); renderAction(S.room, S.room.hand); return; }
    if (b.dataset.bid) emit('bid', { level: b.dataset.bid === 'pass' ? null : Number(b.dataset.bid) });
    if (b.dataset.suit) emit('call', { suit: b.dataset.suit });
  }

  function renderMe(r, h) {
    const el = $('#meRow');
    if (r.mySeat < 0) { el.innerHTML = ''; return; }
    const i = r.mySeat;
    const { av, meta, tag, bub } = seatInner(r, h, i);
    const team = teamOf(h, i);
    el.className = `me-row ${h && h.turn === i && h.phase !== 'done' ? 'turn' : ''} ${team ? `team-${team}` : ''}`;
    let hint = '';
    if (h && h.phase === 'play' && h.turn === i && h.trick.length < 5) hint = 'Tocca a te: gioca una carta';
    el.innerHTML = `<div class="me-name">${bub}<div class="plate-me"><div class="avatar">${av}</div><span>${esc(r.seats[i].name)}</span></div><span class="me-meta">${meta}${tag}</span></div>
      <div class="hint">${hint}</div>
      <div style="position:relative"><button class="icon-btn" data-quick="toggle" aria-expanded="${S.quickOpen}">💬 <span>Frasi</span></button>
      ${S.quickOpen ? `<div class="quick-pop" style="left:auto;right:0">${Object.entries(r.quick).map(([k, v]) => `<button data-quick="${k}">${esc(v)}</button>`).join('')}<button class="open-chat" data-quick="chat">Scrivi in chat</button></div>` : ''}</div>`;
  }

  function onMeRowClick(e) {
    const b = e.target.closest('[data-quick]');
    if (!b) return;
    const k = b.dataset.quick;
    if (k === 'toggle') S.quickOpen = !S.quickOpen;
    else if (k === 'chat') { S.quickOpen = false; if ($('.side-chat')) $('.side-chat input').focus(); else openDrawer('chat'); }
    else { emit('chat', { quick: k }); S.quickOpen = false; }
    renderMe(S.room, S.room.hand);
  }

  function renderHand(r, h) {
    const el = $('#hand');
    if (!h) { el.innerHTML = ''; return; }
    const active = h.phase === 'play' && h.turn === r.mySeat && h.trick.length < 5;
    el.className = `hand ${active ? 'active' : ''}`;
    el.innerHTML = h.myHand.map((id) => C.html(id, id === h.calledCard ? 'called-mine' : '').replace('<div class="card', `<div tabindex="${active ? 0 : -1}" role="button" class="card`)).join('');
  }

  function onHandClick(e) {
    const c = e.target.closest('.card');
    if (!c) return;
    const h = S.room.hand;
    if (!(h && h.phase === 'play' && h.turn === S.room.mySeat && h.trick.length < 5)) return;
    const area = $('#trick').getBoundingClientRect();
    const b = c.getBoundingClientRect();
    S.lastPlayedFrom = { x: b.left + b.width / 2 - area.left, y: b.top + b.height / 2 - area.top };
    c.style.visibility = 'hidden';
    $('#hand').classList.remove('active');
    emit('play', { card: c.dataset.id }, (res) => { if (res && !res.ok) c.style.visibility = ''; });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('card') && e.target.closest('#hand')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ------------------------------------------------------------ risultato e fine partita
  let countdownTimer;
  function renderOverlay(r, h) {
    const el = $('#overlay');
    clearInterval(countdownTimer);
    const nm = (i) => esc(r.seats[i].name);
    if (r.status === 'over') {
      const order = r.scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
      el.innerHTML = `<div class="overlay"><div class="result-card"><h2>Ha vinto ${r.winners.map(nm).join(' e ')}</h2>
        <p class="sub">Partita a ${r.targetScore} punti, ${r.handNo} mani giocate.</p>
        <div class="rows">${order.map(([s, i]) => `<div><span>${nm(i)}</span><span class="${s >= 0 ? 'pos' : 'neg'}">${s > 0 ? '+' : ''}${s}</span></div>`).join('')}</div>
        <div class="btns"><button class="btn ghost" data-ov="lobby">Torna ai tavoli</button>${r.isHost ? '<button class="btn gold" data-ov="rematch">Rivincita</button>' : ''}</div></div></div>`;
      el.onclick = (e) => {
        const b = e.target.closest('[data-ov]');
        if (!b) return;
        if (b.dataset.ov === 'rematch') emit('rematch');
        else emit('leaveRoom');
      };
      return;
    }
    if (!h || h.phase !== 'done' || !h.result || S.resultHidden === `${r.handNo}`) { el.innerHTML = ''; return; }
    const res = h.result;
    const teamNames = res.solo ? `${nm(h.caller)} da solo` : `${nm(h.caller)} e ${nm(h.partner)}`;
    const mine = r.mySeat >= 0 ? res.delta[r.mySeat] : null;
    el.innerHTML = `<div class="overlay"><div class="result-card">
      <h2>${teamNames} ${res.won ? 'hanno vinto' : 'hanno perso'}${res.solo ? '' : ''}${res.cappotto ? '<span class="stamp">cappotto</span>' : ''}</h2>
      <p class="sub">Chiamato il ${esc(C.name(h.calledCard))}, servivano ${res.target} punti.</p>
      <div class="score-line"><span class="big">${res.teamPoints}</span><span>a ${res.defenderPoints}</span></div>
      <div class="rows">${r.seats.map((s, i) => `<div><span class="${i === h.caller || i === h.partner ? 'tc' : ''}">${nm(i)}${i === h.caller ? ' ♛' : ''} <small>(${res.captured[i]} punti presi)</small></span><span class="${res.delta[i] >= 0 ? 'pos' : 'neg'}">${res.delta[i] > 0 ? '+' : ''}${res.delta[i]} → ${r.scores[i]}</span></div>`).join('')}</div>
      <div class="btns"><span class="countdown" id="cd"></span><button class="btn ghost small" data-ov="hide">Guarda il tavolo</button></div>
      ${mine !== null ? '' : ''}</div></div>`;
    el.onclick = (e) => { if (e.target.closest('[data-ov=hide]')) { S.resultHidden = `${r.handNo}`; el.innerHTML = ''; } };
    const tick = () => {
      const cd = $('#cd');
      if (!cd || !r.nextHandAt) return;
      const sec = Math.max(0, Math.ceil((r.nextHandAt - (Date.now() + S.clockOffset)) / 1000));
      cd.textContent = `Prossima mano tra ${sec}s`;
    };
    tick();
    countdownTimer = setInterval(tick, 500);
  }

  // ------------------------------------------------------------ cassetti: punti/storico e chat
  function openDrawer(kind) {
    S.drawer = kind;
    S.quickOpen = false;
    const d = $('#drawer');
    const title = kind === 'score' ? 'Punti e storico' : 'Chat';
    d.innerHTML = `<div class="drawer-bg" data-close="1"></div><aside class="drawer" role="dialog" aria-label="${title}">
      <header><h2>${title}</h2><button class="icon-btn" data-close="1" aria-label="Chiudi">✕</button></header>
      ${kind === 'score' ? '<div class="body" id="drawerBody"></div>' : chatInner()}</aside>`;
    d.onclick = (e) => { if (e.target.closest('[data-close]')) closeDrawer(); };
    if (kind === 'chat') { bindChat(d.querySelector('.drawer')); S.unread = 0; updateUnread(); setTimeout(() => d.querySelector('input').focus(), 50); }
    renderDrawerBody();
    renderChatLogs();
  }
  function closeDrawer() { S.drawer = null; $('#drawer').innerHTML = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.drawer) closeDrawer(); });

  function renderDrawerBody() {
    if (S.drawer !== 'score') return;
    const r = S.room;
    const body = $('#drawerBody');
    if (!body) return;
    const max = Math.max(r.targetScore, ...r.scores.map(Math.abs));
    const lead = Math.max(...r.scores);
    const rows = r.seats.map((s, i) => [r.scores[i], i]).sort((a, b) => b[0] - a[0])
      .map(([sc, i]) => `<tr class="${sc === lead && sc > 0 ? 'lead' : ''}"><td>${esc(r.seats[i].name)}<div class="bar"><i style="width:${Math.max(0, sc) / max * 100}%"></i></div></td><td class="n">${sc > 0 ? '+' : ''}${sc}</td></tr>`).join('');
    const hist = r.history.length ? r.history.map((x) => {
      const nm = (i) => esc(r.seats[i].name);
      const team = x.solo ? `${nm(x.caller)} da solo` : `${nm(x.caller)} con ${nm(x.partner)}`;
      return `<div class="hist-item"><div class="top"><b>Mano ${x.n}</b><span class="${x.won ? 'won' : 'lost'}">${x.won ? 'vinta' : 'persa'} ${x.teamPoints} a ${120 - x.teamPoints}${x.cappotto ? ', cappotto' : ''}</span></div>
        <div>${team}, chiamato il ${esc(C.name(x.called))} (asta: ${esc(x.bid)})</div>
        <div class="deltas">${x.delta.map((d, i) => `<span class="${d > 0 ? 'pos' : 'neg'}">${nm(i)} ${d > 0 ? '+' : ''}${d}</span>`).join('')}</div></div>`;
    }).join('') : '<p class="me-chip">Le mani giocate compariranno qui.</p>';
    body.innerHTML = `<div class="slate"><div class="goal">Si vince a ${r.targetScore}</div><table>${rows}</table></div><div class="hist">${hist}</div>`;
  }

  function chatInner() {
    return `<div class="chat-log"></div>
      <div class="quick-row">${Object.entries((S.room && S.room.quick) || {}).map(([k, v]) => `<button data-q="${k}">${esc(v)}</button>`).join('')}</div>
      <form class="chat-form"><input class="input" maxlength="200" placeholder="Scrivi al tavolo" aria-label="Messaggio"><button class="btn small" type="submit">Invia</button></form>`;
  }
  function bindChat(root) {
    root.querySelector('.chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = e.target.querySelector('input');
      const t = inp.value.trim();
      if (t) emit('chat', { text: t });
      inp.value = '';
    });
    root.querySelector('.quick-row').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (b) emit('chat', { quick: b.dataset.q });
    });
  }
  function renderChatLogs() {
    const r = S.room;
    if (!r) return;
    document.querySelectorAll('.chat-log').forEach((log) => {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      log.innerHTML = r.chat.map((m) => m.system ? `<div class="msg system">${esc(m.text)}</div>` :
        `<div class="msg ${m.seat === r.mySeat ? 'mine' : ''} ${m.quick ? 'quick' : ''}">${m.seat === r.mySeat ? '' : `<b>${esc(m.name)}</b>`}${esc(m.text)}</div>`).join('');
      if (atBottom || !log.dataset.init) { log.scrollTop = log.scrollHeight; log.dataset.init = '1'; }
    });
  }
  function onChatUpdate(room) {
    const fresh = room.chat.filter((m) => !S.seenChat.has(m.id));
    fresh.forEach((m) => S.seenChat.add(m.id));
    if (!S.chatInit) { S.chatInit = true; return; }
    for (const m of fresh) {
      if (m.system || m.seat === null) continue;
      S.bubbles[m.seat] = { text: m.text, until: Date.now() + 3500 };
      setTimeout(() => { if (S.screen === 'game' && S.gameBuilt) { renderSeats(S.room, S.room.hand); renderMe(S.room, S.room.hand); } }, 3600);
      const chatVisible = S.drawer === 'chat' || $('.side-chat');
      if (!chatVisible && m.seat !== room.mySeat && !m.quick) S.unread++;
    }
    updateUnread();
  }
  function updateUnread() {
    const b = $('#unread');
    if (!b) return;
    b.hidden = !S.unread;
    b.textContent = S.unread;
  }

  // ------------------------------------------------------------ avvio
  window.addEventListener('resize', () => {
    if (S.screen !== 'game') return;
    const wide = window.matchMedia('(min-width: 1100px)').matches;
    const isWide = !!$('.side-chat');
    if (wide !== isWide) { S.gameBuilt = false; buildGame(); }
  });
  if (S.name && S.password) { S.screen = 'lobby'; renderLobby(); connect(); } else render();
})();
