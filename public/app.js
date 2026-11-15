'use strict';
(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const isAdmin = location.pathname === '/admin';

  const DOW = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const DOW_FULL = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const short = (s) => { const d = parse(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MND[d.getMonth()]}`; };
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  };
  const initial = (n) => esc((n || '?').trim().charAt(0).toUpperCase());

  const ICON_CHECK = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0B1210" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_LOGO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B1210" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.5 5.5c3 3 3 10 0 13"/><path d="M18.5 5.5c-3 3-3 10 0 13"/></svg>';
  const ICON_ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B1210" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';

  let toastTimer;
  function toast(msg, err) {
    toastEl.textContent = msg;
    toastEl.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2600);
  }

  let playerToken = '';
  async function api(method, url, body, pin) {
    const headers = { 'Content-Type': 'application/json' };
    if (pin) headers['x-admin-pin'] = pin;
    else if (playerToken) headers['x-player-token'] = playerToken;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Er ging iets mis.'); e.status = res.status; throw e; }
    return data;
  }

  const header = (right) => `<div class="top"><a class="brand" href="/"><span class="logo">${ICON_LOGO}</span>Padel Planner</a>${right || ''}</div>`;

  // ================= speler: stemmen =================
  // Toegang alleen met een persoonlijke link: /p/<naam>-<code>. De code wordt op dit apparaat onthouden.
  let data = null;
  let sel = new Set();
  let dirty = false;
  let name = '';
  const linkMatch = location.pathname.match(/^\/p\/(?:[^/]*-)?([a-f0-9]{10})\/?$/);
  playerToken = linkMatch ? linkMatch[1] : (localStorage.getItem('padel-token') || '');

  const mine = () => data.round.votes.find((v) => v.name.toLowerCase() === name.toLowerCase());

  function countsFor(date) {
    const others = data.round.votes.filter((v) => v.name.toLowerCase() !== name.toLowerCase() && v.dates.includes(date)).length;
    return others + (sel.has(date) ? 1 : 0);
  }

  function renderNoAccess(msg) {
    app.innerHTML = `${header()}
      <div class="col" style="gap:6px"><h1>Alleen met een link</h1>
      <p class="sub">${esc(msg || 'Deze pagina is alleen toegankelijk met een persoonlijke link.')} Vraag de organisator om jouw link.</p></div>`;
  }

  function renderVote() {
    const r = data.round;
    const min = r.settings.minPlayers;
    const today = data.today;
    // groepeer per week
    const weeks = [];
    for (const date of r.dates) {
      const d = parse(date);
      const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const key = `${mon.getFullYear()}-${mon.getMonth()}-${mon.getDate()}`;
      let w = weeks[weeks.length - 1];
      if (!w || w.key !== key) { w = { key, nr: isoWeek(d), dates: [] }; weeks.push(w); }
      w.dates.push(date);
    }
    const readyDates = r.dates.filter((d) => d >= today && countsFor(d) >= min);
    const known = data.players.length;
    const voted = data.round.votes.length + (mine() ? 0 : (sel.size ? 1 : 0));

    const acc = r.accepted;
    const banner = acc ? `<div class="banner"><span class="small" style="color:var(--lime);font-weight:600">GEPLAND</span><b>${esc(short(acc.date))}</b>${r.settings.club ? `<span class="small">${esc(r.settings.club)}</span>` : ''}</div>` : '';

    app.innerHTML = `${header(`<div class="chip"><span class="avatar">${initial(name)}</span>${esc(name)}</div>`)}
      <div class="col" style="gap:6px"><h1>Wanneer kun jij?</h1>
      <p class="sub">Tik op de dagen die voor jou werken. Bij ${min} spelers doet de app een voorstel aan de organisator.</p></div>
      ${banner}
      <div class="card row"><div class="col"><span class="small">Kandidaat-data</span>
        <span class="big">${readyDates.length === 1 ? '1 datum' : readyDates.length + ' data'} met ${min} spelers</span></div>
        <span class="small">${voted} van ${Math.max(known, voted)} gestemd</span></div>
      <div class="grid" id="grid">${weeks.map((w) => {
        const f = parse(w.dates[0]), l = parse(w.dates[w.dates.length - 1]);
        const range = f.getMonth() === l.getMonth() ? `${f.getDate()} – ${l.getDate()} ${MND[l.getMonth()]}` : `${f.getDate()} ${MND[f.getMonth()]} – ${l.getDate()} ${MND[l.getMonth()]}`;
        return `<div class="weekhead"><span>Week ${w.nr}</span><span class="small">${range}</span></div>` + w.dates.map((date) => {
          const d = parse(date), total = countsFor(date), isMine = sel.has(date), isReady = total >= min, past = date < today;
          const dots = Array.from({ length: min }, (_, i) => `<span class="dot${i < total ? ' on' : ''}"></span>`).join('');
          return `<button class="day${isMine ? ' mine' : ''}${isReady ? ' ready' : ''}" data-date="${date}" aria-pressed="${isMine}" ${past ? 'disabled' : ''} aria-label="${esc(short(date))}, ${total} van ${min} spelers${isMine ? ', jij kunt' : ''}">
            <span class="dow">${DOW[d.getDay()].toUpperCase()}</span><span class="num">${d.getDate()}</span><span class="dots">${dots}</span>
            <span class="lab">${isReady ? 'Compleet' : total + ' / ' + min}</span>${isMine ? `<span class="check">${ICON_CHECK}</span>` : ''}</button>`;
        }).join('');
      }).join('')}</div>
      <div class="bar"><div class="inner"><button class="btn" id="save">${saveLabel()}</button></div></div>`;

    document.getElementById('grid').addEventListener('click', (e) => {
      const b = e.target.closest('.day'); if (!b || b.disabled) return;
      const date = b.dataset.date;
      sel.has(date) ? sel.delete(date) : sel.add(date);
      dirty = true;
      const y = window.scrollY; renderVote(); window.scrollTo(0, y);
    });
    document.getElementById('save').addEventListener('click', saveVote);
  }
  const saveLabel = () => (dirty ? `Opslaan · ${sel.size} ${sel.size === 1 ? 'datum' : 'data'}` : (mine() ? `Opgeslagen · ${sel.size} ${sel.size === 1 ? 'datum' : 'data'}` : `Opslaan · ${sel.size} ${sel.size === 1 ? 'datum' : 'data'}`));

  async function saveVote() {
    const btn = document.getElementById('save'); btn.disabled = true;
    try {
      data = await api('POST', '/api/vote', { dates: [...sel] });
      dirty = false; toast('Opgeslagen, bedankt!');
    } catch (e) {
      if (e.status === 401) return renderNoAccess('Deze link is niet (meer) geldig.');
      toast(e.message, true);
    }
    renderVote();
  }

  async function loadVote() {
    if (!playerToken) return renderNoAccess();
    try {
      const w = await api('GET', '/api/whoami?token=' + encodeURIComponent(playerToken));
      name = w.name; localStorage.setItem('padel-token', playerToken);
      data = await api('GET', '/api/state');
    } catch (e) {
      if (e.status === 404 || e.status === 401) { localStorage.removeItem('padel-token'); playerToken = ''; return renderNoAccess('Deze link is niet (meer) geldig.'); }
      throw e;
    }
    if (!dirty) sel = new Set((mine() || { dates: [] }).dates);
    renderVote();
  }

  // ================= organisator =================
  let pin = sessionStorage.getItem('padel-pin') || '';
  let links = {};
  let issued = {};
  async function fetchLinks() {
    try { const r = await api('GET', '/api/admin/links', null, pin); links = {}; issued = {}; r.links.forEach((l) => { links[l.name.toLowerCase()] = location.origin + l.path; issued[l.name.toLowerCase()] = l.issued; }); } catch (e) { /* niet fataal */ }
  }
  function markIssued(n) {
    if (issued[n.toLowerCase()]) return;
    api('POST', '/api/admin/link-issued', { name: n }, pin).then(fetchLinks).then(renderAdmin).catch(() => {});
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { window.prompt('Kopieer deze link:', t); return false; }
  }

  function renderPinGate(msg) {
    app.innerHTML = `${header()}
      <div class="col" style="gap:6px"><span class="eyebrow">Beheer</span><h1>Pincode</h1><p class="sub">Alleen voor de organisator.</p></div>
      <form id="pinform" class="field"><label class="lbl" for="pin">Pincode</label>
      <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
      ${msg ? `<p class="small" style="color:var(--danger)">${esc(msg)}</p>` : ''}
      <button class="btn" type="submit"><span>Open beheer</span>${ICON_ARROW}</button></form>`;
    document.getElementById('pinform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p = document.getElementById('pin').value;
      try { await api('GET', '/api/admin/check', null, p); pin = p; sessionStorage.setItem('padel-pin', p); loadAdmin(); }
      catch (err) { renderPinGate(err.message); }
    });
  }

  async function adminCall(method, url, body) {
    try { data = await api(method, url, body, pin); await fetchLinks(); renderAdmin(); return true; }
    catch (e) {
      if (e.status === 401) { sessionStorage.removeItem('padel-pin'); pin = ''; return renderPinGate(e.message); }
      toast(e.message, true); return false;
    }
  }

  function shareText() {
    const r = data.round, p = data.proposal;
    const when = r.accepted ? r.accepted.date : (p && p.date);
    const names = r.accepted ? data.rows.find((x) => x.date === r.accepted.date) : p;
    const list = names ? names.names.join(', ') : '';
    const lead = r.accepted ? `Padel staat gepland op ${short(when)}` : `Voorstel voor padel: ${when ? short(when) : '...'}`;
    return `${lead}${r.settings.club ? ' (' + r.settings.club + ')' : ''}.${list ? ' Mee: ' + list + '.' : ''}\nStem via je persoonlijke link.`;
  }

  function candCard(row, kind) {
    const min = data.round.settings.minPlayers;
    const cls = kind === 'main' ? 'proposal' : 'proposal plain';
    const badge = kind === 'main' ? `<span class="badge">Voorstel · ${row.count} / ${min}</span>` : kind === 'reserve' ? `<span class="badge outline">Reserve · ${row.count} / ${min}</span>` : `<span class="badge dim">${row.count} / ${min} · nog ${Math.max(0, min - row.count)} nodig</span>`;
    return `<div class="${cls}"><div class="row"><div><span class="title">${esc(short(row.date))}</span></div>${badge}</div>
      <div class="names">${row.names.map((n) => `<span class="name">${esc(n)}</span>`).join('')}</div>
      ${kind === 'reserve' ? `<button class="btn ghost" data-accept="${row.date}">Neem deze als voorstel</button>` : ''}</div>`;
  }

  function renderAdmin() {
    const r = data.round, s = r.settings, p = data.proposal, acc = r.accepted;
    const accRow = acc ? data.rows.find((x) => x.date === acc.date) : null;
    app.innerHTML = `${header()}
      <div class="col" style="gap:6px"><span class="eyebrow">Beheer</span><h1>Mijn voorstel</h1>
      <p class="sub">${r.votes.length} van ${data.players.length} hebben gestemd. Accepteer het voorstel en boek zelf de baan.</p></div>
      ${acc ? `<div class="banner"><span class="small" style="color:var(--lime);font-weight:600">GEACCEPTEERD</span><b>${esc(short(acc.date))}</b>${accRow ? `<span class="small">${accRow.names.map(esc).join(', ')}</span>` : ''}<div style="margin-top:8px"><button class="btn ghost small" id="reopen">Ongedaan maken</button></div></div>` : ''}
      ${p ? candCard(p, 'main') : `<div class="card"><p class="sub">Nog geen datum met ${s.minPlayers} spelers. Zodra die er is, verschijnt hier een voorstel.</p></div>`}
      ${data.reserve ? candCard(data.reserve, 'reserve') : ''}
      ${data.others.map((o) => candCard(o, 'other')).join('')}
      ${p || acc ? `<div class="bar"><div class="inner">
        ${!acc && p ? `<button class="btn" id="accept" data-accept="${p.date}"><span>Accepteer ${esc(short(p.date))}</span></button>` : ''}
        <button class="btn ghost" id="wa">Stuur naar groep in WhatsApp</button></div></div>` : ''}
      ${data.notVoted.length ? `<div class="card row"><div class="col"><span class="small">Nog niet gestemd</span><span style="font-size:14px;font-weight:600">${data.notVoted.map(esc).join(', ')}</span></div></div>` : ''}
      <details><summary>Spelers beheren</summary>
        <p class="small">Alleen spelers met een persoonlijke link kunnen de app openen en stemmen. Voeg iedereen toe en stuur hem zijn eigen link. Die werkt op elk apparaat.</p>
        <form id="addp" class="row" style="align-items:stretch"><input id="addname" type="text" maxlength="30" placeholder="Naam van nieuwe speler" aria-label="Naam van nieuwe speler" style="flex:1;min-width:0"><button class="btn small" type="submit">Toevoegen</button></form>
        <div class="plist">${data.players.length ? data.players.map((n) => `<div class="prow"><span class="pname">${esc(n)}${issued[n.toLowerCase()] ? ' <span class="small">· link gedeeld</span>' : ''}</span><div class="pbtns"><button class="btn ghost small" data-link="${esc(n)}" aria-label="Kopieer link van ${esc(n)}">Link</button><button class="btn ghost small" data-wal="${esc(n)}" aria-label="Stuur link naar ${esc(n)} via WhatsApp">WhatsApp</button><button class="btn ghost small danger" data-remove="${esc(n)}" aria-label="Verwijder ${esc(n)}">Verwijder</button></div></div>`).join('') : '<p class="sub">Nog geen spelers.</p>'}</div>
      </details>
      <details id="newround"><summary>Nieuwe ronde starten</summary>
        <div class="field"><label class="lbl" for="weeks">Weken vooruit (1 t/m 8)</label><input id="weeks" type="number" min="1" max="8" value="${s.weeks}"></div>
        <div class="field"><span class="lbl">Speeldagen</span><div class="dayspick" id="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-d="${d}" aria-pressed="${s.days.includes(d)}">${DOW_FULL[d]}</button>`).join('')}</div></div>
        <div class="field"><label class="lbl" for="min">Spelers nodig</label><input id="min" type="number" min="2" max="12" value="${s.minPlayers}"></div>
        <div class="field"><label class="lbl" for="club">Club (optioneel)</label><input id="club" type="text" maxlength="60" value="${esc(s.club)}"></div>
        <label class="check-row"><input id="hol" type="checkbox" ${s.skipHolidays ? 'checked' : ''}> Nederlandse feestdagen overslaan</label>
        <p class="small">De data worden automatisch berekend uit de kalender, vanaf de eerstvolgende maandag. Een nieuwe ronde wist de huidige stemmen.</p>
        <button class="btn" id="mk"><span>Maak ronde</span>${ICON_ARROW}</button>
      </details>`;

    const reopen = document.getElementById('reopen');
    if (reopen) reopen.addEventListener('click', () => adminCall('POST', '/api/admin/reopen'));
    app.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
      if (await adminCall('POST', '/api/admin/accept', { date: b.dataset.accept })) toast('Geaccepteerd. Veel plezier!');
    }));
    const wa = document.getElementById('wa');
    if (wa) wa.addEventListener('click', () => window.open('https://wa.me/?text=' + encodeURIComponent(shareText()), '_blank', 'noopener'));
    app.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      if (confirm(`${b.dataset.remove} en zijn/haar stemmen verwijderen?`)) adminCall('POST', '/api/admin/remove-player', { name: b.dataset.remove });
    }));
    app.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
      const url = links[b.dataset.link.toLowerCase()];
      if (!url) return toast('Link niet beschikbaar, probeer het opnieuw.', true);
      if (await copyText(url)) toast('Link van ' + b.dataset.link + ' gekopieerd');
      markIssued(b.dataset.link);
    }));
    app.querySelectorAll('[data-wal]').forEach((b) => b.addEventListener('click', () => {
      const url = links[b.dataset.wal.toLowerCase()];
      if (!url) return toast('Link niet beschikbaar, probeer het opnieuw.', true);
      window.open('https://wa.me/?text=' + encodeURIComponent(`Hoi ${b.dataset.wal}, dit is jouw persoonlijke link om je beschikbaarheid voor padel in te vullen: ${url}`), '_blank', 'noopener');
      markIssued(b.dataset.wal);
    }));
    document.getElementById('addp').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = document.getElementById('addname').value.replace(/\s+/g, ' ').trim();
      if (v && await adminCall('POST', '/api/admin/player-link', { name: v })) toast(v + ' toegevoegd');
    });
    document.getElementById('days').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (b) b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    });
    document.getElementById('mk').addEventListener('click', () => {
      if (!confirm('Nieuwe ronde starten? De huidige stemmen worden gearchiveerd.')) return;
      const days = [...document.querySelectorAll('#days button[aria-pressed=true]')].map((b) => Number(b.dataset.d));
      adminCall('POST', '/api/admin/round', { weeks: document.getElementById('weeks').value, days, minPlayers: document.getElementById('min').value, club: document.getElementById('club').value, skipHolidays: document.getElementById('hol').checked }).then((ok) => ok && toast('Nieuwe ronde staat klaar.'));
    });
  }

  async function loadAdmin() {
    if (!pin) return renderPinGate();
    try { data = await api('GET', '/api/state', null, pin); await api('GET', '/api/admin/check', null, pin); await fetchLinks(); renderAdmin(); }
    catch (e) { renderPinGate(e.status === 401 ? e.message : ''); }
  }

  // ================= start =================
  const start = isAdmin ? loadAdmin : loadVote;
  start().catch((e) => { app.innerHTML = `${header()}<div class="card"><p class="sub">${esc(e.message || 'Kon de gegevens niet laden.')}</p></div>`; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !dirty && (isAdmin ? pin : true)) start().catch(() => {}); });
})();
