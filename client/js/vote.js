(() => {
  const windowms = 20000;
  const tickms = 250;

  let live = null;
  let seq = 0;

  const handlers = new Map();

  const stack = document.getElementById('toast-stack');

  function lobby() {
    return (window.party?.peers?.size || 0) + 1;
  }

  function needed(total) {
    return Math.ceil(total / 2);
  }

  function uid() {
    return `${window.party?.myid?.() || 'x'}-v${Date.now().toString(36)}-${(seq++).toString(36)}`;
  }

  function card(label, from, endsat, onpick) {
    const el = document.createElement('div');
    el.className = 'toast vote-toast interactive entering';
    el.dataset.status = 'idle';

    const body = document.createElement('div');
    body.className = 'toast-body';

    const name = document.createElement('span');
    name.className = 'toast-name';
    name.textContent = from;

    const sub = document.createElement('span');
    sub.className = 'toast-sub';
    sub.textContent = label;

    body.append(name, sub);

    const bar = document.createElement('div');
    bar.className = 'vote-bar';
    const fill = document.createElement('div');
    fill.className = 'vote-fill';
    bar.appendChild(fill);

    const row = document.createElement('div');
    row.className = 'vote-row';

    const yes = document.createElement('button');
    yes.className = 'mini vote-yes';
    yes.textContent = 'Accept';

    const no = document.createElement('button');
    no.className = 'mini ghost vote-no';
    no.textContent = 'Decline';

    row.append(no, yes);
    el.append(body, bar, row);
    stack.appendChild(el);

    void el.offsetWidth;
    el.classList.remove('entering');

    let done = false;
    const finish = (choice) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      el.style.height = `${el.offsetHeight}px`;
      void el.offsetWidth;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
      onpick(choice);
    };

    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));

    const total = endsat - Date.now();
    const timer = setInterval(() => {
      const left = endsat - Date.now();
      fill.style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
      if (left <= 0) finish(null);
    }, tickms);

    return { close: () => finish(null) };
  }

  function labelfor(kind, payload) {
    if (kind === 'theater') return 'wants to start Theater';
    return `wants to start ${payload?.name || kind}`;
  }

  function tally() {
    if (!live || !live.owner) return;

    const total = live.total;
    const want = needed(total);
    const yes = live.yes.size;
    const no = live.no.size;

    if (yes >= want) return settle(true);
    if (total - no < want) return settle(false);
    if (Date.now() >= live.endsat) return settle(yes >= want);
  }

  function settle(passed) {
    if (!live || live.settled) return;
    live.settled = true;
    clearInterval(live.timer);

    window.party?.broadcast({ t: 'voteend', id: live.id, passed });

    const { kind, payload, id } = live;
    live.card?.close();
    live = null;

    if (passed) handlers.get(kind)?.(payload, id, window.party.myid());
    else window.toasts?.show({
      name: 'Vote failed',
      activity: 'Not enough of the party accepted',
      status: 'offline',
      duration: 4000
    });
  }

  function start(kind, payload) {
    if (live) return false;

    const total = lobby();
    const id = uid();

    if (total <= 1) {
      handlers.get(kind)?.(payload, id, window.party.myid());
      return true;
    }

    const endsat = Date.now() + windowms;

    live = {
      id, kind, payload, owner: true, total, endsat,
      yes: new Set([window.party.myid()]),
      no: new Set(),
      settled: false,
      card: null,
      timer: setInterval(tally, tickms)
    };

    window.party.broadcast({ t: 'votestart', id, kind, payload, endsat });

    window.toasts?.show({
      name: 'Waiting on the party',
      activity: labelfor(kind, payload).replace('wants to', 'You want to'),
      status: 'idle',
      duration: 3000
    });

    tally();
    return true;
  }

  function on(kind, fn) {
    handlers.set(kind, fn);
  }

  window.party?.onmessage((from, m) => {
    if (m.t === 'votestart') {
      if (live) {
        window.party.sendto(from, { t: 'votecast', id: m.id, yes: false });
        return;
      }

      live = { id: m.id, kind: m.kind, payload: m.payload, from, owner: false, settled: false };

      live.card = card(
        labelfor(m.kind, m.payload),
        window.party.infofor(from).name,
        m.endsat,
        (choice) => {
          if (choice === null) return;
          window.party.sendto(from, { t: 'votecast', id: m.id, yes: choice });
        }
      );
    }
    else if (m.t === 'votecast') {
      if (!live || !live.owner || live.id !== m.id) return;
      live.yes.delete(from);
      live.no.delete(from);
      (m.yes ? live.yes : live.no).add(from);
      tally();
    }
    else if (m.t === 'voteend') {
      if (!live || live.owner || live.id !== m.id) return;
      const { kind, payload, id, from: owner } = live;
      live.card?.close();
      live = null;
      if (m.passed) handlers.get(kind)?.(payload, id, owner);
    }
  });

  window.overlay.onroster(({ members }) => {
    if (!live || !live.owner) return;
    const set = new Set(members || []);
    live.yes.forEach(id => { if (!set.has(id)) live.yes.delete(id); });
    live.no.forEach(id => { if (!set.has(id)) live.no.delete(id); });
    live.total = lobby();
    tally();
  });

  window.vote = { start, on, lobby, needed, isopen: () => !!live };
})();
