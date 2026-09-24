(() => {
  const maxlines = 120; // ring buffer size
  const refreshms = 700;

  let panel = null;
  let statebox = null;

  let statsbox = null;
  let logbox = null;
  let timer = null;
  let paused = false;

  const lines = [];

  function stamp() {
    const d = new Date();
    return `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }

  function short(value) {
    let text;
    try { text = JSON.stringify(value); } catch { text = String(value); } // circular refs fall back here
    if (!text) return '';
    return text.length > 220 ? text.slice(0, 220) + '…' : text; // trim for the log box
  }

  window.debuglog = (dir, type, payload, from) => {
    lines.push({
      time: stamp(),
      dir,
      type: type || '?',
      who: from || '',
      body: short(payload)
    });
    if (lines.length > maxlines) lines.shift();
    if (panel && !paused) paintlog();
  };
  function paintlog() {
    if (!logbox) return;
    const stuck = logbox.scrollTop + logbox.clientHeight >= logbox.scrollHeight - 30; // autoscroll only if already at bottom

    logbox.innerHTML = '';
    lines.forEach(l => {
      const row = document.createElement('div');
      row.className = `dbg-line dbg-${l.dir}`;
      row.textContent = `${l.time} ${l.dir === 'out' ? '▲' : '▼'} ${l.type}${l.who ? ` <${l.who}>` : ''} ${l.body}`;
      logbox.appendChild(row);
    });

    if (stuck) logbox.scrollTop = logbox.scrollHeight;
  }

  function paintstate() {
    if (!statebox) return;
    const r = window.party?.report?.();
    if (!r) { statebox.textContent = 'no mesh'; return; }

    const out = [];
    out.push(`me: ${r.myid}`);
    out.push(`local streams: ${r.localstreams.length
      ? r.localstreams.map(s => `${s.id.slice(0, 8)} [${s.tracks.join(', ')}]`).join(' | ')
      : 'none'}`);
    out.push('');

    r.peers.forEach(p => {
      out.push(`peer ${p.id}  polite=${p.polite}`);
      out.push(`  conn=${p.conn} ice=${p.ice} sig=${p.sig}`);
      out.push(`  channels cursor=${p.cursor} ctrl=${p.ctrl} bulk=${p.bulk}`);
      out.push(`  inbound: ${p.instream}`);
      out.push(`  receivers: ${p.receivers}`);
      p.transceivers.forEach(t => out.push(`  tr ${t}`));
      out.push('');
    });

    statebox.textContent = out.join('\n');
  }

  async function paintstats() {
    if (!statsbox) return;
    const rows = await window.party?.rtpstats?.();
    if (!rows) return;
    statsbox.textContent = rows.length
      ? rows.map(r => `${r.id}\n  out ${r.sent}\n  in  ${r.recv}`).join('\n')
      : 'no peers';
  }


  function build() {

    panel = document.createElement('div');
    panel.id = 'debugpanel';
    panel.className = 'interactive';

    const head = document.createElement('div');
    head.className = 'dbg-head';

    const title = document.createElement('span');
    title.className = 'dbg-title';
    title.textContent = 'DEBUG';

    const hold = document.createElement('button');
    hold.className = 'mini ghost';
    hold.textContent = 'Pause log';
    hold.addEventListener('click', () => {
      paused = !paused;
      hold.textContent = paused ? 'Resume log' : 'Pause log';
    });

    const wipe = document.createElement('button');
    wipe.className = 'mini ghost';
    wipe.textContent = 'Clear';
    wipe.addEventListener('click', () => { lines.length = 0; paintlog(); });

    const copy = document.createElement('button');
    copy.className = 'mini ghost';
    copy.textContent = 'Copy all';
    copy.addEventListener('click', () => {
      const blob = [
        statebox.textContent,
        '--- rtp ---',
        statsbox.textContent,
        '--- log ---',
        lines.map(l => `${l.time} ${l.dir} ${l.type} ${l.who} ${l.body}`).join('\n')
      ].join('\n');
      navigator.clipboard.writeText(blob);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy all'; }, 1200);
    });

    const shut = document.createElement('button');
    shut.className = 'mini ghost';
    shut.textContent = '✕';
    shut.addEventListener('click', hide);

    head.append(title, hold, wipe, copy, shut);

    statebox = document.createElement('pre');
    statebox.className = 'dbg-state';

    const statshead = document.createElement('div');
    statshead.className = 'dbg-sub';
    statshead.textContent = 'RTP';

    statsbox = document.createElement('pre');
    statsbox.className = 'dbg-stats';

    const loghead = document.createElement('div');
    loghead.className = 'dbg-sub';
    loghead.textContent = 'PROTOCOL';

    logbox = document.createElement('div');
    logbox.className = 'dbg-log';

    panel.append(head, statebox, statshead, statsbox, loghead, logbox);
    document.body.appendChild(panel);
  }

  function show() {
    if (panel) return;
    build();
    paintstate();
    paintstats();
    paintlog();
    timer = setInterval(() => {
      paintstate();
      paintstats();
    }, refreshms);
    window.refreshignore?.();
  }

  function hide() {
    clearInterval(timer);
    timer = null;
    panel?.remove();
    panel = null;
    statebox = null;
    statsbox = null;
    logbox = null;
    window.refreshignore?.();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
      e.preventDefault();
      panel ? hide() : show(); // toggle
    }
  });

  window.debugpanel = {
    show,
    hide,
    toggle: () => (panel ? hide() : show()),
    isopen: () => !!panel
  };
})();
