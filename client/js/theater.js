(() => {
  const closems = 900;
  const holdms = 1000;
  const partms = 1100;

  let root = null;
  let curtains = null;
  let screen = null;
  let video = null;
  let seatrow = null;
  let statusline = null;
  let controls = null;
  let ask = null;

  let open = false;
  let controller = null;
  let saved = null;
  let live = false;
  let driving = null;
  let hunt = null;

  const mine = () => controller === window.party?.myid?.();
  const note = (text) => window.debuglog?.('out', 'theater', text);

  function buildcurtains() {
    curtains = document.createElement('div');
    curtains.id = 'curtains';
    curtains.innerHTML =
      '<div class="curtain curtainleft"></div>' +
      '<div class="curtain curtainright"></div>';
    document.body.appendChild(curtains);
    return curtains;
  }

  function buildroot() {
    root = document.createElement('div');
    root.id = 'theater';
    root.className = 'interactive';

    const stagewrap = document.createElement('div');
    stagewrap.className = 'th-stage';

    screen = document.createElement('div');
    screen.className = 'th-screen';

    video = document.createElement('video');
    video.className = 'th-video hidden';
    video.playsInline = true;
    video.autoplay = true;

    const idle = document.createElement('div');
    idle.className = 'th-idle';
    idle.id = 'theateridle';
    idle.textContent = 'Nothing playing';

    screen.append(video, idle);
    stagewrap.appendChild(screen);

    statusline = document.createElement('div');
    statusline.className = 'th-status';

    controls = document.createElement('div');
    controls.className = 'th-controls';

    ask = document.createElement('div');
    ask.className = 'th-ask hidden';

    seatrow = document.createElement('div');
    seatrow.className = 'th-seats';

    root.append(stagewrap, statusline, controls, ask, seatrow);
    document.body.appendChild(root);
    return root;
  }

  function askurl() {
    return new Promise(resolve => {
      ask.innerHTML = '';
      ask.classList.remove('hidden');

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'th-input';
      input.placeholder = 'Any link — it gets screen shared to the party';
      input.spellcheck = false;

      const go = document.createElement('button');
      go.className = 'mini';
      go.textContent = 'Share';

      const cancel = document.createElement('button');
      cancel.className = 'mini ghost';
      cancel.textContent = 'Cancel';

      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        ask.classList.add('hidden');
        ask.innerHTML = '';
        resolve(value);
      };

      go.addEventListener('click', () => finish(input.value.trim() || null));
      cancel.addEventListener('click', () => finish(null));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(input.value.trim() || null);
        if (e.key === 'Escape') finish(null);
      });

      ask.append(input, go, cancel);
      input.focus();
    });
  }

  function buildcontrols() {
    controls.innerHTML = '';

    const dbg = document.createElement('button');
    dbg.className = 'mini ghost';
    dbg.textContent = 'Debug';
    dbg.addEventListener('click', () => window.debugpanel?.toggle());

    if (!mine()) {
      const leave = document.createElement('button');
      leave.className = 'mini ghost';
      leave.textContent = 'Leave';
      leave.addEventListener('click', () => close(false));
      controls.append(leave, dbg);
      return;
    }

    const link = document.createElement('button');
    link.className = 'mini';
    link.textContent = 'Share a link';
    link.addEventListener('click', picklink);

    const end = document.createElement('button');
    end.className = 'mini ghost';
    end.textContent = 'End for everyone';
    end.addEventListener('click', () => close(true));

    controls.append(link, end, dbg);

    if (window.media.iscapturing()) {
      let muted = false;
      const sound = document.createElement('button');
      sound.className = 'mini ghost';
      sound.textContent = 'Mute audio';
      sound.addEventListener('click', () => {
        muted = !muted;
        window.media.setmuted(muted);
        sound.textContent = muted ? 'Unmute audio' : 'Mute audio';
      });
      controls.insertBefore(sound, end);
    }
  }

  function modifiers(e) {
    const out = [];
    if (e.shiftKey) out.push('shift');
    if (e.ctrlKey)  out.push('control');
    if (e.altKey)   out.push('alt');
    if (e.metaKey)  out.push('meta');
    return out;
  }

  function tostage(e) {
    const size = window.media.stagesize();
    if (!size || !video.videoWidth) return null;

    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const shownw = video.videoWidth * scale;
    const shownh = video.videoHeight * scale;
    const offx = (rect.width - shownw) / 2;
    const offy = (rect.height - shownh) / 2;

    const px = (e.clientX - rect.left - offx) / shownw;
    const py = (e.clientY - rect.top - offy) / shownh;
    if (px < 0 || px > 1 || py < 0 || py > 1) return null;

    return { x: Math.round(px * size.w), y: Math.round(py * size.h) };
  }

  const buttons = ['left', 'middle', 'right'];

  function drive() {
    if (driving) return;
    screen.classList.add('th-live');
    let lastmove = 0;

    const move = (e) => {
      const now = performance.now();
      if (now - lastmove < 16) return;
      lastmove = now;
      const p = tostage(e);
      if (p) window.overlay.stageinput({ type: 'mouseMove', ...p, modifiers: modifiers(e) });
    };

    const down = (e) => {
      const p = tostage(e);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      window.overlay.stageinput({
        type: 'mouseDown', ...p,
        button: buttons[e.button] || 'left',
        clickCount: e.detail || 1,
        modifiers: modifiers(e)
      });
    };

    const up = (e) => {
      const p = tostage(e);
      if (!p) return;
      e.preventDefault();
      window.overlay.stageinput({
        type: 'mouseUp', ...p,
        button: buttons[e.button] || 'left',
        clickCount: e.detail || 1,
        modifiers: modifiers(e)
      });
    };

    const wheel = (e) => {
      const p = tostage(e);
      if (!p) return;
      e.preventDefault();
      window.overlay.stageinput({
        type: 'mouseWheel', ...p,
        deltaX: -e.deltaX, deltaY: -e.deltaY,
        canScroll: true, modifiers: modifiers(e)
      });
    };

    const menu = (e) => e.preventDefault();

    const key = (e) => {
      if (!ask.classList.contains('hidden')) return;
      if (e.key === 'Escape' || e.key === 'F9') return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

      e.preventDefault();
      e.stopPropagation();
      const mods = modifiers(e);
      window.overlay.stageinput({ type: 'keyDown', keyCode: e.key, modifiers: mods });
      if (e.key.length === 1) {
        window.overlay.stageinput({ type: 'char', keyCode: e.key, modifiers: mods });
      }
      window.overlay.stageinput({ type: 'keyUp', keyCode: e.key, modifiers: mods });
    };

    video.addEventListener('pointermove', move);
    video.addEventListener('pointerdown', down);
    video.addEventListener('pointerup', up);
    video.addEventListener('wheel', wheel, { passive: false });
    video.addEventListener('contextmenu', menu);
    window.addEventListener('keydown', key, true);

    driving = () => {
      screen?.classList.remove('th-live');
      video.removeEventListener('pointermove', move);
      video.removeEventListener('pointerdown', down);
      video.removeEventListener('pointerup', up);
      video.removeEventListener('wheel', wheel);
      video.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', key, true);
      driving = null;
    };
  }

  function undrive() { driving?.(); }

  function setidle(text) {
    const idle = document.getElementById('theateridle');
    if (!idle) return;
    idle.textContent = text || '';
    idle.classList.toggle('hidden', !text);
  }

  function play() {
    const attempt = video.play();
    if (!attempt?.catch) return;
    attempt.catch((e) => {
      note(`play rejected: ${e.name} ${e.message}`);
      if (e.name === 'NotAllowedError') {
        setidle('Click the screen to start playback');
        screen.addEventListener('click', () => {
          setidle('');
          video.play().catch(() => {});
        }, { once: true });
      } else {
        setidle(`Playback failed: ${e.message}`);
      }
    });
  }

  async function picklink() {
    const raw = await askurl();
    if (!raw) return;

    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setidle('Starting the stream…');
    note(`sharing ${url}`);

    try {
      if (window.media.iscapturing()) {
        await window.media.stagego(url);
      } else {
        const stream = await window.media.broadcaststart(url);
        const mode = window.media.audiomode();
        note(`capture up: ${stream.getTracks().map(t => t.kind).join('+')} mode=${mode}`);

        video.srcObject = stream;
        video.muted = mode !== 'frame';
        video.classList.remove('hidden');
        play();
      }

      live = true;
      drive();
      buildcontrols();
      window.party.broadcast({ t: 'theatermedia', mode: 'broadcast', url });
      setidle('');
      statusline.textContent = window.media.audiomode() === 'system'
        ? 'Sharing — system audio, everything you hear is shared'
        : 'Sharing — click the screen to control it';
    } catch (e) {
      note(`share failed: ${e.message}`);
      setidle(`Stream failed: ${e.message}`);
    }
  }

  function attachstream() {
    if (!open || !controller || mine()) return false;

    const stream = window.party.streamfor(controller);
    if (!stream) { note('no stream yet'); return false; }

    const track = stream.getVideoTracks()[0];
    if (!track) { note('stream has no video track'); return false; }

    if (video.srcObject === stream) return true;

    note(`attaching ${stream.id.slice(0, 8)} video muted=${track.muted}`);

    video.srcObject = stream;
    video.muted = false;
    video.classList.remove('hidden');
    setidle(track.muted ? 'Waiting for frames…' : '');
    play();

    track.addEventListener('unmute', () => {
      note('track unmuted — frames arriving');
      setidle('');
      play();
    });

    track.addEventListener('mute', () => note('track muted'));

    return true;
  }

  function starthunt() {
    clearInterval(hunt);
    let tries = 0;
    hunt = setInterval(() => {
      tries++;
      if (attachstream() || tries > 40) {
        clearInterval(hunt);
        hunt = null;
      }
    }, 500);
  }

  function seats() {
    if (!seatrow) return;
    seatrow.innerHTML = '';

    const ids = [window.party.myid(), ...window.party.peers.keys()].filter(Boolean).sort();

    ids.slice(0, 8).forEach(id => {
      const info = window.party.infofor(id);

      const seat = document.createElement('div');
      seat.className = 'th-seat';

      const head = document.createElement('div');
      head.className = 'th-head';
      if (info.avatar) head.style.backgroundImage = `url('${info.avatar}')`;
      head.style.setProperty('--seat-color', window.party.colorfor(id));

      const tag = document.createElement('span');
      tag.className = 'th-tag';
      tag.textContent = info.name;

      seat.append(tag, head);
      seatrow.appendChild(seat);
    });
  }

  function stash() {
    saved = {
      objects: window.physics?.snapshot?.() || [],
      players: window.players?.snapshot?.() || [],
      ink: window.draw?.snapshot?.() || null
    };
    window.physics?.wipe?.();
    window.players?.wipe?.();
    window.draw?.wipe?.();
  }

  function unstash() {
    if (!saved) return;
    window.physics?.restore?.(saved.objects);
    window.players?.restore?.(saved.players);
    window.draw?.restore?.(saved.ink);
    saved = null;
  }

  async function enter(owner) {
    if (open) return;
    open = true;
    controller = owner;
    note(`theater open, controller=${owner}`);

    window.menu?.close();
    if (window.browser?.isopen?.()) window.browser.toggle();

    buildcurtains();
    void curtains.offsetWidth;
    curtains.classList.add('shut');

    await new Promise(r => setTimeout(r, closems + holdms));

    stash();
    buildroot();
    buildcontrols();
    seats();

    statusline.textContent = mine()
      ? 'You are in control'
      : `${window.party.infofor(controller).name} is in control`;

    window.overlay.menuactive(true);
    window.refreshignore?.();

    void root.offsetWidth;
    root.classList.add('lit');
    curtains.classList.add('open');

    setTimeout(() => { curtains?.remove(); curtains = null; }, partms);

    if (live) starthunt();
  }

  function close(broadcast) {
    if (!open) return;
    open = false;

    if (broadcast) window.party?.broadcast({ t: 'theaterclose' });

    clearInterval(hunt);
    hunt = null;
    undrive();

    if (mine()) window.media.broadcaststop();

    video?.pause?.();
    if (video) { video.removeAttribute('src'); video.srcObject = null; }

    root?.remove();
    root = null;
    curtains?.remove();
    curtains = null;
    controller = null;
    live = false;

    unstash();

    window.overlay.menuactive(false);
    window.refreshignore?.();
  }

  window.party?.onstream((from) => {
    note(`ontrack from ${from}`);
    if (open && from === controller) starthunt();
  });

  window.party?.onmessage((from, m) => {
    if (m.t === 'theateropen') enter(from);
    else if (m.t === 'theaterclose') close(false);
    else if (m.t === 'theatermedia') {
      if (from !== controller) {
        if (window.media.iscapturing()) {
          note(`ignoring media from ${from}; I am sharing`);
          return;
        }
        note(`controller was ${controller}, adopting ${from}`);
        controller = from;
        undrive();
        buildcontrols();
        statusline.textContent = `${window.party.infofor(from).name} is in control`;
      }
      live = true;
      setidle('Waiting for the stream…');
      starthunt();
    }
  });

  window.overlay.onroster(({ members }) => {
    if (!open) return;
    const set = new Set(members || []);
    if (controller && !set.has(controller) && !mine()) { close(false); return; }
    seats();
  });

  window.vote?.on('theater', (payload, id, owner) => {
    if (open) return;
    const boss = owner || window.party.myid();
    if (boss === window.party.myid()) window.party?.broadcast({ t: 'theateropen' });
    enter(boss);
  });

  window.theater = {
    request() {
      if (open) return;
      window.vote.start('theater', { name: 'Theater' });
    },
    close,
    isopen: () => open
  };
})();
