// ---- party mesh (webrtc cursors, profiles, datachannels) ----
(() => {
  const ice = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80',  username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  };

  const sendms = 33;
  const smoothing = 0.25;
  const colors = ['#23d18b','#3a8ef0','#ffd24a','#e0508c','#9b6cf0','#22c8c8','#f06a3a','#c0c0c0'];

  let myid = null;
  let profile = { userid: '', displayName: '', avatar: '', accent: '', characterImage: '' };
  let doing = '';
  let joined = false;
  let settings = {
    showNames: true,
    allowRemoteClicks: false,
    allowDrawing: true,
    sendMyClicks: false
  };

  const peers = new Map();
  const profiles = new Map();
  const accents = new Map();
  const doings = new Map();
  const external = [];
  const bulkhandlers = [];
  const streamhandlers = [];
  const localstreams = new Set();
  const retries = new Map();

  const layer = document.getElementById('cursor-layer');
  if (layer) layer.style.zIndex = '250';
  const local = document.getElementById('cursor-local');
  const panel = document.getElementById('partytoast');

  function hashed(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
  }

  function colorfor(id) {
    if (!id) return colors[0];
    if (id === myid && profile.accent) return profile.accent;
    return accents.get(id) || hashed(id);
  }

  function applyaccent() {
    if (!myid) return;
    document.documentElement.style.setProperty('--green', colorfor(myid));
  }

  const namefor = (id) => profiles.get(id)?.displayName || id;

  function applysettings() {
    document.body.classList.toggle('hide-names', !settings.showNames);
  }

  function makecursor(id) {
    const el = document.createElement('div');
    el.className = 'cursor remote';
    el.style.setProperty('--cursor-color', colorfor(id));
    el.innerHTML =
      '<svg viewBox="0 0 16 16"><path d="M1 1l5 13 2-5 5-2z"/></svg>' +
      '<span class="cursor-label"></span>';
    el.querySelector('.cursor-label').textContent = id;
    layer.appendChild(el);
    return el;
  }

  function ripple(x, y, color) {
    const dot = document.createElement('div');
    dot.className = 'click-ripple';
    dot.style.setProperty('--cursor-color', color);
    dot.style.left = `${x * window.innerWidth}px`;
    dot.style.top  = `${y * window.innerHeight}px`;
    layer.appendChild(dot);
    setTimeout(() => dot.remove(), 500);
  }

  function makepeer(id) {
    if (peers.has(id)) return peers.get(id);

    const pc = new RTCPeerConnection(ice);
    const entry = {
      pc, channel: null, ctrl: null, bulk: null, outbox: [],
      videosender: null, audiosender: null, instream: null,
      remoteset: false, waiting: [],
      polite: false, makingoffer: false, ignoring: false,
      el: makecursor(id),
      target: { x: .5, y: .5 }, pos: { x: .5, y: .5 }
    };
    entry.polite = String(myid) > String(id);
    peers.set(id, entry);

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingoffer = true;
        const offer = await pc.createOffer();
        offer.sdp = tuneaudio(offer.sdp);
        await pc.setLocalDescription(offer);
        window.overlay.signal({
          to: id, type: 'offer',
          sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp }
        });
      } catch (e) {
        console.warn('negotiation failed:', e);
      } finally {
        entry.makingoffer = false;
      }
    };

    pc.ontrack = (e) => {
      window.debuglog?.('in', 'ontrack', `${e.track?.kind} muted=${e.track?.muted}`, id);
      if (e.streams && e.streams[0]) entry.instream = e.streams[0];
      streamhandlers.forEach(fn => fn(id, entry.instream));
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        window.overlay.signal({ to: id, type: 'candidate', candidate: e.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`pc[${id}]:`, pc.connectionState);
      if (pc.connectionState === 'failed') pc.restartIce();
      if (pc.connectionState === 'closed') drop(id);
      render();
    };

    pc.ondatachannel = (e) => {
      if (e.channel.label === 'bulk') bindbulk(entry, id, e.channel);
      else if (e.channel.label === 'ctrl') bindctrl(entry, id, e.channel);
      else bind(entry, id, e.channel);
    };
    return entry;
  }

  function handle(entry, id, m) {
      if (m.t !== 'c') window.debuglog?.('in', m.t, m, id);
      if (m.t === 'c') {
        entry.target.x = m.x;
        entry.target.y = m.y;
      }
      else if (m.t === 'k') {
        ripple(m.x, m.y, colorfor(id));
        if (settings.allowRemoteClicks) window.overlay.remoteclick({ x: m.x, y: m.y });
      }
      else if (m.t === 'p') {
        profiles.set(id, {
          displayName: m.displayName || id,
          avatar: m.avatar || '',
          characterImage: m.characterImage || ''
        });
        if (m.accent) accents.set(id, m.accent);
        else accents.delete(id);

        entry.el.querySelector('.cursor-label').textContent = m.displayName || id;
        entry.el.style.setProperty('--cursor-color', colorfor(id));
        render();
      }
      else if (m.t === 'a') {
        doings.set(id, m.text || '');
      }
      else if (m.t === 'd' || m.t === 'dclear') {
        if (settings.allowDrawing) window.draw?.apply(m);
      }
      else {
        external.forEach(fn => fn(id, m));
      }
  }

  function parse(entry, id, e) {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handle(entry, id, m);
  }

  function bind(entry, id, dc) {
    entry.channel = dc;

    dc.onopen = () => {
      clearTimeout(retries.get(id));
      retries.delete(id);
      entry.el.style.opacity = 1;
      render();
    };

    dc.onclose = () => { entry.el.style.opacity = 0; render(); };
    dc.onmessage = (e) => parse(entry, id, e);
  }

  function bindctrl(entry, id, dc) {
    entry.ctrl = dc;

    dc.onopen = () => {
      entry.outbox.splice(0).forEach(text => {
        try { dc.send(text); } catch {}
      });

      dc.send(JSON.stringify({
        t: 'p',
        displayName: profile.displayName,
        avatar: profile.avatar,
        accent: profile.accent,
        characterImage: profile.characterImage
      }));
      dc.send(JSON.stringify({ t: 'a', text: doing }));

      window.browser?.onpeer(id);
      window.physics?.onpeer(id);
      render();
    };

    dc.onclose = () => { if (entry.ctrl === dc) entry.ctrl = null; };
    dc.onmessage = (e) => parse(entry, id, e);
  }

  function bindbulk(entry, id, dc) {
    entry.bulk = dc;
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => bulkhandlers.forEach(fn => fn(id, e.data));
    dc.onclose = () => { if (entry.bulk === dc) entry.bulk = null; };
  }

  function tuneaudio(sdp) {
    if (!sdp) return sdp;

    const match = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
    if (!match) return sdp;

    const pt = match[1];
    const wanted = 'stereo=1;sprop-stereo=1;maxaveragebitrate=320000;maxplaybackrate=48000;useinbandfec=1;usedtx=0';
    const has = new RegExp(`a=fmtp:${pt} .*`, 'i');

    if (has.test(sdp)) {
      return sdp.replace(has, (line) => {
        const kept = line
          .replace(/;?(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|useinbandfec|usedtx)=[^;\r\n]*/gi, '')
          .replace(/a=fmtp:\d+\s*/i, '')
          .replace(/^;+|;+$/g, '');
        return `a=fmtp:${pt} ${kept ? kept + ';' : ''}${wanted}`;
      });
    }

    return sdp.replace(
      new RegExp(`(a=rtpmap:${pt} opus\/48000\/2\r?\n)`, 'i'),
      `$1a=fmtp:${pt} ${wanted}\r\n`
    );
  }

  function boost(sender, kind) {
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = kind === 'audio' ? 320000 : 4000000;
      if (kind === 'video') params.degradationPreference = 'maintain-resolution';
      sender.setParameters(params).catch(() => {});
    } catch {}
  }

  function opendirections(entry) {
    entry.pc.getTransceivers().forEach(t => {
      const kind = t.receiver?.track?.kind || t.sender?.track?.kind;
      if (kind !== 'video' && kind !== 'audio') return;
      try { if (t.direction !== 'sendrecv') t.direction = 'sendrecv'; } catch {}
    });
  }

  function wiresenders(entry) {
    entry.pc.getTransceivers().forEach(t => {
      const kind = t.receiver?.track?.kind || t.sender?.track?.kind;
      if (kind === 'video' && !entry.videosender) entry.videosender = t.sender;
      if (kind === 'audio' && !entry.audiosender) entry.audiosender = t.sender;
    });
  }

  function attach(entry, stream) {
    wiresenders(entry);
    const video = stream.getVideoTracks()[0] || null;
    const audio = stream.getAudioTracks()[0] || null;

    if (entry.videosender && video) {
      entry.videosender.replaceTrack(video).catch(e => console.warn('video swap failed:', e));
      boost(entry.videosender, 'video');
    }
    if (entry.audiosender && audio) {
      entry.audiosender.replaceTrack(audio).catch(e => console.warn('audio swap failed:', e));
      boost(entry.audiosender, 'audio');
    }
  }

  function detach(entry) {
    entry.videosender?.replaceTrack(null).catch(() => {});
    entry.audiosender?.replaceTrack(null).catch(() => {});
  }

  function drop(id) {
    const entry = peers.get(id);
    if (!entry) return;
    clearTimeout(retries.get(id));
    retries.delete(id);
    entry.channel?.close();
    entry.pc.close();
    entry.el.remove();
    peers.delete(id);
    profiles.delete(id);
    accents.delete(id);
    doings.delete(id);
    render();
  }

  async function flush(entry) {
    entry.remoteset = true;
    for (const c of entry.waiting.splice(0)) {
      try { await entry.pc.addIceCandidate(c); } catch (e) { console.warn(e); }
    }
  }

  async function invite(id, attempt = 1) {
    const existing = peers.get(id);
    if (existing?.channel?.readyState === 'open') return;
    if (existing) drop(id);

    const entry = makepeer(id);
    bind(entry, id, entry.pc.createDataChannel('cursor', {
      ordered: false, maxRetransmits: 0
    }));
    bindctrl(entry, id, entry.pc.createDataChannel('ctrl', { ordered: true }));
    bindbulk(entry, id, entry.pc.createDataChannel('bulk', { ordered: true }));

    try {
      entry.pc.addTransceiver('video', { direction: 'sendrecv' });
      entry.pc.addTransceiver('audio', { direction: 'sendrecv' });
    } catch (e) {
      console.warn('transceiver setup failed:', e);
    }

    opendirections(entry);
    wiresenders(entry);
    localstreams.forEach(stream => attach(entry, stream));

    clearTimeout(retries.get(id));
    if (attempt < 4) {
      retries.set(id, setTimeout(() => {
        const p = peers.get(id);
        if (p?.channel?.readyState === 'open') return;
        console.log(`[peer] retrying invite to ${id} (attempt ${attempt + 1})`);
        invite(id, attempt + 1);
      }, 5000));
    }
  }

  const lossy = new Set(['c', 'k', 'objstate', 'plu']);

  function post(entry, payload, text) {
    if (!lossy.has(payload.t)) window.debuglog?.('out', payload.t, payload);
    if (lossy.has(payload.t)) {
      if (entry.channel?.readyState === 'open') entry.channel.send(text);
      return;
    }

    if (entry.ctrl?.readyState === 'open') {
      entry.ctrl.send(text);
      return;
    }

    entry.outbox.push(text);
    if (entry.outbox.length > 200) entry.outbox.shift();
  }

  function broadcast(payload) {
    const text = JSON.stringify(payload);
    peers.forEach(e => post(e, payload, text));
  }

  function sendto(id, payload) {
    const e = peers.get(id);
    if (e) post(e, payload, JSON.stringify(payload));
  }

  function onmessage(fn) { external.push(fn); }
  function onbulk(fn) { bulkhandlers.push(fn); }
  function onstream(fn) { streamhandlers.push(fn); }

  function sendbulk(id, buf) {
    const e = peers.get(id);
    if (e?.bulk?.readyState !== 'open') return false;
    e.bulk.send(buf);
    return true;
  }

  function bulkamount(id) {
    const e = peers.get(id);
    return e?.bulk?.bufferedAmount ?? Infinity;
  }

  function bulkready(id) {
    return peers.get(id)?.bulk?.readyState === 'open';
  }

  function addstream(stream) {
    localstreams.clear();
    localstreams.add(stream);
    peers.forEach(e => attach(e, stream));
  }

  function dropstream(stream) {
    localstreams.delete(stream);
    peers.forEach(detach);
  }

  function streamfor(id) {
    const e = peers.get(id);
    if (!e) return null;

    const tracks = e.pc.getReceivers()
      .map(r => r.track)
      .filter(t => t && t.readyState === 'live');

    if (!tracks.length) return e.instream || null;

    const held = e.instream ? e.instream.getTracks() : [];
    const same = held.length === tracks.length && tracks.every(t => held.includes(t));

    if (!same) {
      e.instream = new MediaStream(tracks);
      window.debuglog?.('in', 'stream', `built from ${tracks.length} receiver track(s)`, id);
    }

    return e.instream;
  }

  function report() {
    const out = {
      myid,
      localstreams: [...localstreams].map(st => ({
        id: st.id,
        tracks: st.getTracks().map(t => `${t.kind}:${t.readyState}${t.muted ? ':muted' : ''}`)
      })),
      peers: []
    };

    peers.forEach((e, id) => {
      out.peers.push({
        id,
        polite: e.polite,
        conn: e.pc.connectionState,
        ice: e.pc.iceConnectionState,
        sig: e.pc.signalingState,
        cursor: e.channel?.readyState || '-',
        ctrl: e.ctrl?.readyState || '-',
        bulk: e.bulk?.readyState || '-',
        instream: e.instream
          ? e.instream.getTracks().map(t => `${t.kind}:${t.readyState}${t.muted ? ':muted' : ''}`).join(' ')
          : 'none',
        receivers: e.pc.getReceivers()
          .map(r => r.track ? `${r.track.kind}:${r.track.readyState}${r.track.muted ? ':muted' : ':live'}` : 'null')
          .join(' ') || 'none',
        transceivers: e.pc.getTransceivers().map(t => {
          const kind = t.receiver?.track?.kind || t.sender?.track?.kind || '?';
          return `${kind} dir=${t.direction} now=${t.currentDirection || '-'} send=${t.sender?.track?.kind || 'null'}`;
        })
      });
    });

    return out;
  }

  async function rtpstats() {
    const rows = [];
    for (const [id, e] of peers) {
      try {
        const stats = await e.pc.getStats();
        let sent = null, recv = null;
        stats.forEach(r => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            sent = `${Math.round((r.bytesSent || 0) / 1024)}KB enc=${r.framesEncoded || 0}`;
          }
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            recv = `${Math.round((r.bytesReceived || 0) / 1024)}KB dec=${r.framesDecoded || 0}`;
          }
        });
        rows.push({ id, sent: sent || 'no outbound-rtp', recv: recv || 'no inbound-rtp' });
      } catch (err) {
        rows.push({ id, sent: `err ${err.message}`, recv: '-' });
      }
    }
    return rows;
  }

  function render() {
    panel.classList.toggle('hidden', !joined);
    if (!joined || !myid) return;

    const ids = [...peers.keys()].sort();

    document.getElementById('partycount').textContent = `${ids.length + 1}/8`;
    document.getElementById('partynames').textContent =
      ids.length ? ids.map(namefor).join(', ') : 'Just you';

    const image = document.getElementById('partyimage');
    if (profile.avatar) image.src = profile.avatar;

    const stack = document.getElementById('partystack');
    stack.innerHTML = '';
    ids.slice(0, 5).forEach(id => {
      const face = document.createElement('div');
      const open = peers.get(id)?.ctrl?.readyState === 'open';
      face.className = `pp-face${open ? '' : ' pending'}`;
      face.style.setProperty('--face-color', colorfor(id));
      const av = profiles.get(id)?.avatar;
      if (av) face.style.backgroundImage = `url('${av}')`;
      stack.appendChild(face);
    });
  }

  window.overlay.onsignal(async (msg) => {
    const from = msg.from;
    try {
      if (msg.type === 'offer') {
        if (!msg.sdp?.sdp) return;

        const entry = makepeer(from);
        const collision = entry.makingoffer || entry.pc.signalingState !== 'stable';
        entry.ignoring = !entry.polite && collision;
        if (entry.ignoring) return;

        await entry.pc.setRemoteDescription(msg.sdp);
        await flush(entry);

        opendirections(entry);
        wiresenders(entry);
        localstreams.forEach(stream => attach(entry, stream));

        const answer = await entry.pc.createAnswer();
        answer.sdp = tuneaudio(answer.sdp);
        await entry.pc.setLocalDescription(answer);
        window.overlay.signal({
          to: from, type: 'answer',
          sdp: { type: entry.pc.localDescription.type, sdp: entry.pc.localDescription.sdp }
        });
      }
      else if (msg.type === 'answer') {
        const entry = peers.get(from);
        if (!entry || !msg.sdp?.sdp) return;
        if (entry.pc.signalingState !== 'have-local-offer') return;
        await entry.pc.setRemoteDescription(msg.sdp);
        await flush(entry);
        wiresenders(entry);
        localstreams.forEach(stream => attach(entry, stream));
      }
      else if (msg.type === 'candidate') {
        if (!msg.candidate?.candidate) return;
        const entry = peers.get(from);
        if (!entry) return;
        if (!entry.remoteset) { entry.waiting.push(msg.candidate); return; }
        try { await entry.pc.addIceCandidate(msg.candidate); }
        catch (e) { if (!entry.ignoring) throw e; }
      }
    } catch (e) {
      console.warn('signal failed:', msg.type, e);
    }
  });

  window.overlay.onidentity(({ userid }) => {
    myid = userid;
    local.style.setProperty('--cursor-color', colorfor(myid));
    applyaccent();
    render();
  });

  window.overlay.onprofile((p) => {
    profile = p;
    const image = document.getElementById('partyimage');
    if (image && p.avatar) image.src = p.avatar;
    local.style.setProperty('--cursor-color', colorfor(myid));
    applyaccent();
    broadcast({
      t: 'p',
      displayName: p.displayName,
      avatar: p.avatar,
      accent: p.accent,
      characterImage: p.characterImage
    });
    render();
  });

  window.overlay.onactivity((a) => {
    doing = a.details ? `${a.app}: ${a.details}` : a.app;
    broadcast({ t: 'a', text: doing });
  });

  window.overlay.onsettings((s) => {
    settings = { ...settings, ...s };
    applysettings();
  });

  window.overlay.onroster(({ myid: me, partyId, members }) => {
    if (me) myid = me;
    joined = !!partyId;

    const list = (members || []).filter(id => id !== myid);

    peers.forEach((_, id) => { if (!list.includes(id)) drop(id); });

    if (joined) {
      list.forEach(id => {
        if (peers.get(id)?.channel?.readyState === 'open') return;
        if (myid < id) invite(id);
      });
    } else {
      window.draw?.clearcanvas();
      window.draw?.setvisible(false);
      window.menu?.close();
    }

    applyaccent();
    render();
  });

  let sent = 0;
  window.overlay.onlocalcursor((p) => {
    local.style.transform = `translate(${p.x * window.innerWidth}px, ${p.y * window.innerHeight}px)`;
    const now = performance.now();
    if (now - sent < sendms) return;
    sent = now;
    broadcast({ t: 'c', x: p.x, y: p.y });
  });

  window.overlay.onlocalclick((p) => broadcast({ t: 'k', x: p.x, y: p.y }));

  function tick() {
    peers.forEach(e => {
      e.pos.x += (e.target.x - e.pos.x) * smoothing;
      e.pos.y += (e.target.y - e.pos.y) * smoothing;
      e.el.style.transform = `translate(${e.pos.x * window.innerWidth}px, ${e.pos.y * window.innerHeight}px)`;
    });
    requestAnimationFrame(tick);
  }
  tick();
  applysettings();

  window.party = {
    broadcast,
    sendto,
    onmessage,
    onbulk,
    onstream,
    sendbulk,
    bulkamount,
    bulkready,
    addstream,
    dropstream,
    streamfor,
    report,
    rtpstats,
    peers,
    colorfor,
    invite,
    myid: () => myid,
    infofor(id) {
      if (id === myid) {
        return {
          name: profile.displayName || myid,
          avatar: profile.avatar,
          character: profile.characterImage,
          activity: doing,
          state: ''
        };
      }
      const p = profiles.get(id) || {};
      return {
        name: p.displayName || id,
        avatar: p.avatar || '',
        character: p.characterImage || '',
        activity: doings.get(id) || '',
        state: peers.get(id)?.ctrl?.readyState === 'open' ? '' : 'connecting…'
      };
    }
  };
})();

// ---- draggable player characters ----
(() => {
  const width = 34;
  const height = 52;
  const margin = 60;
  const broadcastms = 50;
  const threshold = 90;

  const world = document.createElement('div');
  world.id = 'player-world';
  document.body.appendChild(world);

  const players = new Map();
  let myid = null;

  const keys = { a: false, d: false, w: false };
  const typing = (e) => {
    const el = e.target;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'd' || k === 'w') keys[k] = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'a' || k === 'd' || k === 'w') keys[k] = false;
  });

  const namefor = (id) => window.party?.infofor?.(id)?.name || id;
  const skinfor = (id) => window.party?.infofor?.(id)?.character || '';

  function applylook(el, color, skin) {
    el.style.setProperty('--player-color', color);
    if (skin) {
      el.style.backgroundImage = `url('${skin}')`;
      el.classList.add('has-character');
    } else {
      el.style.backgroundImage = '';
      el.classList.remove('has-character');
    }
  }

  function make(id, color, mine, skin, x, y) {
    const wrap = document.createElement('div');
    wrap.className = 'player-wrap';

    const tag = document.createElement('span');
    tag.className = 'player-tag';
    tag.textContent = namefor(id);
    tag.style.setProperty('--player-color', color);

    const el = document.createElement('div');
    el.className = 'player interactive';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
    applylook(el, color, skin || skinfor(id));

    wrap.append(tag, el);
    world.appendChild(wrap);

    const p = {
      id, el, wrap, owner: mine, holder: id,
      hw: width / 2, hh: height / 2,
      body: null,
      dragging: false,
      constraint: null,
      grounded: 0,
      touched: 0,
      history: []
    };

    players.set(id, p);
    window.physics?.attachbody?.(p, x, y);
    render(p);
    return p;
  }

  function render(p) {
    if (!p.body) return;
    const pos = p.body.position;
    p.wrap.style.transform = `translate(${(pos.x - p.hw).toFixed(1)}px, ${(pos.y - p.hh).toFixed(1)}px)`;
    p.el.style.transform = `rotate(${(p.body.angle * 180 / Math.PI).toFixed(2)}deg)`;
  }

  function despawn(id, quiet) {
    const p = players.get(id);
    if (!p) return;
    window.physics?.detachbody?.(p);
    p.wrap.remove();
    players.delete(id);
    if (id === myid && !quiet) window.party.broadcast({ t: 'pld' });
  }

  let sent = 0;
  function beat(now) {
    if (myid && now - sent > broadcastms) {
      sent = now;
      players.forEach(p => {
        if (!p.body || p.holder !== myid) return;
        const pos = p.body.position, v = p.body.velocity;
        window.party.broadcast({
          t: 'plu', who: p.id,
          x: pos.x / window.innerWidth, y: pos.y / window.innerHeight,
          vx: v.x, vy: v.y,
          rot: p.body.angle, w: p.body.angularVelocity
        });
      });
    }
    requestAnimationFrame(beat);
  }
  requestAnimationFrame(beat);

  const handle = document.getElementById('partyavatar');
  let holding = false, armed = true, origin = null, spawned = null;

  handle?.addEventListener('pointerdown', (e) => {
    if (!myid) return;
    e.preventDefault();
    holding = true;
    armed = true;
    spawned = null;
    origin = { x: e.clientX, y: e.clientY };
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });

  handle?.addEventListener('pointermove', (e) => {
    if (!holding) return;

    if (armed) {
      const dx = e.clientX - origin.x, dy = e.clientY - origin.y;
      const dist = Math.hypot(dx, dy);

      if (dist >= threshold) {
        armed = false;
        handle.classList.remove('ready');

        despawn(myid, true);
        const color = window.party.colorfor(myid);
        const skin = window.party.infofor(myid).character || '';
        spawned = make(myid, color, true, skin, e.clientX, e.clientY);

        window.party.broadcast({
          t: 'pls',
          x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight,
          color, skin
        });

        window.physics?.begindrag?.(spawned, e.clientX, e.clientY);
        return;
      }

      handle.classList.toggle('ready', dist > threshold * 0.85);
      return;
    }

    if (spawned) window.physics?.movedrag?.(spawned, e.clientX, e.clientY);
  });

  const letgo = (e) => {
    if (!holding) return;
    holding = false;
    handle.classList.remove('ready');

    if (armed) return;
    if (spawned) {
      window.physics?.enddrag?.(spawned, e.clientX, e.clientY);
      spawned = null;
    }
  };
  handle?.addEventListener('pointerup', letgo);
  handle?.addEventListener('pointercancel', letgo);

  window.party?.onmessage((from, m) => {
    if (m.t === 'pls') {
      despawn(from, true);
      make(
        from,
        m.color || window.party.colorfor(from),
        false,
        m.skin || '',
        m.x * window.innerWidth,
        m.y * window.innerHeight
      );
    }
    else if (m.t === 'pld') despawn(from, true);
    else if (m.t === 'plgrab') {
      const p = players.get(m.who);
      if (p) p.holder = from;
    }
    else if (m.t === 'plrelease') {
      const p = players.get(m.who);
      if (p) p.holder = m.who;
    }
    else if (m.t === 'plu') {
      const p = players.get(m.who || from);
      if (!p || !p.body || p.holder === myid) return;
      window.physics?.applyremote?.(p, m);
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onprofile(() => {
    const p = players.get(myid);
    if (!p) return;
    applylook(p.el, window.party.colorfor(myid), skinfor(myid));
  });

  window.overlay.onroster(({ members }) => {
    const set = new Set(members || []);
    players.forEach((p, id) => { if (id !== myid && !set.has(id)) despawn(id, true); });
  });

  function snapshot() {
    const out = [];
    players.forEach((p, id) => {
      if (!p.body) return;
      out.push({
        id,
        owner: p.owner,
        color: p.el.style.getPropertyValue('--player-color'),
        skin: skinfor(id),
        x: p.body.position.x,
        y: p.body.position.y
      });
    });
    return out;
  }

  function wipe() {
    [...players.keys()].forEach(id => despawn(id, true));
  }

  function restore(list) {
    (list || []).forEach(d => {
      if (players.has(d.id)) return;
      make(d.id, d.color || window.party.colorfor(d.id), d.owner, d.skin, d.x, d.y);
    });
  }

  window.players = {
    despawn,
    snapshot,
    wipe,
    restore,
    render,
    keys,
    myid: () => myid,
    all: () => players,

    bodies() {
      const out = [];
      players.forEach(p => { if (p.body) out.push(p); });
      return out;
    },

    checkkill(p, x, y) {
      if (p.dragging) return false;
      const off =
        x < -margin || x > window.innerWidth + margin ||
        y < -margin || y > window.innerHeight + margin;
      if (off) {
        despawn(p.id, !p.owner);
        if (p.owner) window.overlay.playeractive?.(false);
        return true;
      }
      return false;
    }
  };
})();

// ---- shared physics world (matter.js) ----
(() => {
  const { Engine, Bodies, Body, Composite, Constraint, Sleeping, Events } = Matter;

  const broadcastms = 50;
  const throwwindow = 120;
  const throwmax = 48;
  const maxobjects = 440;
  const authorityms = 4000;
  const wallthick = 200;

  const dragstiff = 0.16;
  const dragdamp = 0.3;

  const bounce = 0.75;

  const moveforce = 0.0042;
  const maxrun = 8.5;
  const aircontrol = 0.4;
  const jump = 0.16;
  const brake = 0.06;

  const uprighttorque = 0.512;
  const uprightdamp = 0.156;
  const uprightair = 0.25;
  const knock = 7;

  const grace = 110;
  const inkcell = 16;

  const minhalf = 10;
  const maxhalf = 260;

  const layer = document.createElement('div');
  layer.id = 'object-world';
  document.body.appendChild(layer);

  const handles = document.createElement('div');
  handles.id = 'handleroot';
  document.body.appendChild(handles);

  const engine = Engine.create({
    gravity: { x: 0, y: 2.6 },
    enableSleeping: true
  });
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  const objects = new Map();
  const bybody = new Map();
  let myid = null;
  let seq = 0;

  const shapes = {
    box:      { w: 46, h: 46 },
    ball:     { w: 44, h: 44 },
    crate:    { w: 66, h: 40 },
    triangle: { w: 50, h: 46 }
  };

  const uid = () => `${myid || 'x'}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

  let walls = [];
  function buildwalls() {
    if (walls.length) Composite.remove(engine.world, walls);
    const w = window.innerWidth, h = window.innerHeight;
    const opts = { isStatic: true, friction: 1.0, restitution: bounce, label: 'wall' };

    walls = [
      Bodies.rectangle(w / 2, h + wallthick / 2, w * 3, wallthick, opts),
      Bodies.rectangle(w / 2, -wallthick / 2, w * 3, wallthick, opts),
      Bodies.rectangle(-wallthick / 2, h / 2, wallthick, h * 3, opts),
      Bodies.rectangle(w + wallthick / 2, h / 2, wallthick, h * 3, opts)
    ];
    Composite.add(engine.world, walls);
  }
  buildwalls();
  window.addEventListener('resize', buildwalls);

  let ink = [];
  let inkqueued = false;

  function buildink() {
    if (!window.draw?.isink) return;

    if (ink.length) {
      Composite.remove(engine.world, ink);
      ink = [];
    }

    const w = window.innerWidth, h = window.innerHeight;
    const opts = { isStatic: true, friction: 1.0, restitution: bounce, label: 'ink' };

    for (let y = 0; y < h; y += inkcell) {
      let run = -1;
      for (let x = 0; x <= w; x += inkcell) {
        const solid = x < w && window.draw.isink(x + inkcell / 2, y + inkcell / 2);
        if (solid && run < 0) run = x;
        if ((!solid || x >= w) && run >= 0) {
          const span = x - run;
          ink.push(Bodies.rectangle(
            run + span / 2, y + inkcell / 2, span, inkcell, opts
          ));
          run = -1;
        }
      }
    }
    if (ink.length) Composite.add(engine.world, ink);
    objects.forEach(o => { if (!o.frozen) Sleeping.set(o.body, false); });
  }

  function queueink() {
    if (inkqueued) return;
    inkqueued = true;
    setTimeout(() => { inkqueued = false; buildink(); }, 180);
  }

  function contact(a, b) {
    const check = (self, other) => {
      const p = bybody.get(self);
      if (!p) return;
      if (other.position.y > self.position.y + p.hh * 0.35) {
        p.grounded = performance.now();
      }
      p.touched = performance.now();
    };
    check(a, b);
    check(b, a);
  }

  Events.on(engine, 'collisionStart', (e) => {
    for (const pair of e.pairs) contact(pair.bodyA, pair.bodyB);
  });
  Events.on(engine, 'collisionActive', (e) => {
    for (const pair of e.pairs) contact(pair.bodyA, pair.bodyB);
  });

  const isgrounded = (p) => performance.now() - (p.grounded || 0) < grace;
  const istouching = (p) => performance.now() - (p.touched || 0) < grace;

  function make(id, shape, color, owner, x, y, hw, hh) {
    const spec = shapes[shape] || shapes.box;
    const halfw = hw || spec.w / 2;
    const halfh = hh || spec.h / 2;

    const el = document.createElement('div');
    el.className = `phys-obj phys-${shape} interactive`;
    el.style.width = halfw * 2 + 'px';
    el.style.height = halfh * 2 + 'px';
    el.style.setProperty('--obj-color', color);
    layer.appendChild(el);

    const opts = {
      friction: 0.75,
      frictionStatic: 1.1,
      frictionAir: 0.006,
      restitution: bounce,
      density: 0.0022,
      sleepThreshold: 40,
      label: 'obj'
    };

    let body;
    if (shape === 'ball') body = Bodies.circle(x, y, halfw, opts);
    else if (shape === 'triangle') body = Bodies.polygon(x, y, 3, halfw, opts);
    else body = Bodies.rectangle(x, y, halfw * 2, halfh * 2, opts);

    Composite.add(engine.world, body);

    const o = {
      id, el, body, shape, color, owner,
      hw: halfw, hh: halfh,
      frozen: false,
      until: 0,
      dragging: false,
      constraint: null,
      history: []
    };

    Object.defineProperty(o, 'mine', { get() { return this.owner === myid; } });

    objects.set(id, o);
    binddrag(o);
    draw(o);
    return o;
  }

  function recover(body) {
    if (!body || body.isStatic) return;
    const p = body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        p.y > window.innerHeight + 2000 || p.y < -2000 ||
        p.x > window.innerWidth + 2000 || p.x < -2000) {
      Body.setPosition(body, { x: window.innerWidth / 2, y: 100 });
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
    }
  }

  function draw(o) {
    recover(o.body);
    o.el.style.transform =
      `translate(${(o.body.position.x - o.hw).toFixed(1)}px, ${(o.body.position.y - o.hh).toFixed(1)}px) ` +
      `rotate(${(o.body.angle * 180 / Math.PI).toFixed(2)}deg)`;
  }

  function remove(id, quiet) {
    const o = objects.get(id);
    if (!o) return;
    if (selected === o) deselect();
    release(o);
    Composite.remove(engine.world, o.body);
    o.el.remove();
    objects.delete(id);
    if (!quiet && o.mine) window.party.broadcast({ t: 'objdel', id });
  }

  function claim(o) {
    const had = o.mine;
    o.owner = myid;
    o.until = performance.now() + authorityms;
    if (!had) window.party.broadcast({ t: 'objclaim', id: o.id });
  }

  function release(entity) {
    if (!entity || !entity.constraint) return;
    Composite.remove(engine.world, entity.constraint);
    entity.constraint = null;
  }

  function freeze(o, on) {
    if (!o || o.frozen === on) return;
    o.frozen = on;
    release(o);
    Body.setStatic(o.body, on);
    if (!on) {
      Sleeping.set(o.body, false);
      Body.setVelocity(o.body, { x: 0, y: 0 });
      Body.setAngularVelocity(o.body, 0);
    }
    o.el.classList.toggle('frozen', on);
  }

  function resize(o, hw, hh) {
    if (!o) return;
    const nextw = Math.max(minhalf, Math.min(maxhalf, hw));
    const nexth = o.shape === 'ball'
      ? nextw
      : Math.max(minhalf, Math.min(maxhalf, hh));

    const sx = nextw / o.hw;
    const sy = nexth / o.hh;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return;

    const wasstatic = o.body.isStatic;
    if (wasstatic) Body.setStatic(o.body, false);
    Body.scale(o.body, sx, sy);
    if (wasstatic) Body.setStatic(o.body, true);

    o.hw = nextw;
    o.hh = nexth;
    o.el.style.width = nextw * 2 + 'px';
    o.el.style.height = nexth * 2 + 'px';

    if (!o.frozen) Sleeping.set(o.body, false);
    draw(o);
  }

  function attachbody(p, x, y) {
    const body = Bodies.rectangle(x, y, p.hw * 2, p.hh * 2, {
      friction: 0.7,
      frictionStatic: 1.0,
      frictionAir: 0.008,
      restitution: bounce * 0.6,
      density: 0.0042,
      sleepThreshold: Infinity,
      label: 'player'
    });
    Composite.add(engine.world, body);
    p.body = body;
    p.grounded = 0;
    p.touched = 0;
    bybody.set(body, p);
    return body;
  }

  function detachbody(p) {
    release(p);
    if (p.body) {
      bybody.delete(p.body);
      Composite.remove(engine.world, p.body);
      p.body = null;
    }
  }

  function drive(p) {
    if (!p.body || !p.owner || p.dragging) return;
    if (p.holder !== p.id && p.holder !== undefined) return;

    const b = p.body;
    const keys = window.players.keys;
    const ground = isgrounded(p);

    let dir = 0;
    if (keys.a) dir -= 1;
    if (keys.d) dir += 1;

    if (dir !== 0) {
      const ratio = Math.min(1, Math.abs(b.velocity.x) / maxrun);
      const same = Math.sign(b.velocity.x) === dir;
      const taper = same ? (1 - ratio * ratio) : 1;

      Body.applyForce(b, b.position, {
        x: dir * moveforce * b.mass * taper * (ground ? 1 : aircontrol),
        y: 0
      });
    } else if (ground) {
      Body.applyForce(b, b.position, {
        x: -b.velocity.x * brake * b.mass * 0.01,
        y: 0
      });
    }

    if (keys.w && ground) {
      Body.applyForce(b, b.position, { x: 0, y: -jump * b.mass });
      p.grounded = 0;
    }

    let err = b.angle;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    const factor = Math.max(0, 1 - speed / knock);
    const scale = (ground || istouching(p)) ? 1 : uprightair;

    b.torque += (-err * uprighttorque - b.angularVelocity * uprightdamp)
                * b.mass * scale * factor;
  }

  function applyremote(p, m) {
    if (!p.body) return;
    Body.setPosition(p.body, {
      x: m.x * window.innerWidth,
      y: m.y * window.innerHeight
    });
    Body.setAngle(p.body, m.rot || 0);
    Body.setVelocity(p.body, { x: m.vx || 0, y: m.vy || 0 });
    Body.setAngularVelocity(p.body, m.w || 0);
  }

  function begindrag(entity, x, y) {
    if (!entity.body) return;
    release(entity);

    const pos = entity.body.position;
    const dx = x - pos.x, dy = y - pos.y;
    const c = Math.cos(-entity.body.angle), s = Math.sin(-entity.body.angle);

    entity.constraint = Constraint.create({
      pointA: { x, y },
      bodyB: entity.body,
      pointB: { x: dx * c - dy * s, y: dx * s + dy * c },
      stiffness: dragstiff,
      damping: dragdamp,
      length: 0
    });
    Composite.add(engine.world, entity.constraint);

    Sleeping.set(entity.body, false);
    entity.dragging = true;
    entity.history = [{ x, y, t: performance.now() }];
    window.dragging = true;
    window.overlay.playeractive?.(true);
  }

  function movedrag(entity, x, y) {
    if (!entity.constraint) return;
    entity.constraint.pointA = { x, y };
    const now = performance.now();
    entity.history.push({ x, y, t: now });
    while (entity.history.length > 1 && now - entity.history[0].t > throwwindow) {
      entity.history.shift();
    }
  }

  function enddrag(entity, x, y) {
    release(entity);
    window.dragging = false;
    window.overlay.playeractive?.(false);
    if (!entity.dragging) return null;
    entity.dragging = false;

    const t = performance.now();
    entity.history.push({ x, y, t });
    while (entity.history.length > 1 && t - entity.history[0].t > throwwindow) {
      entity.history.shift();
    }

    if (entity.history.length >= 2 && entity.body) {
      const first = entity.history[0], last = entity.history[entity.history.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0.005) {
        let vx = ((last.x - first.x) / dt) / 60;
        let vy = ((last.y - first.y) / dt) / 60;
        const speed = Math.hypot(vx, vy);
        if (speed > throwmax) { vx *= throwmax / speed; vy *= throwmax / speed; }
        Body.setVelocity(entity.body, { x: vx, y: vy });
      } else {
        Body.setVelocity(entity.body, { x: 0, y: 0 });
      }
    }
    entity.history = [];
    return entity.body ? entity.body.velocity : null;
  }

  function bindplayerdrag(p) {
    if (p.bound) return;
    p.bound = true;

    p.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      p.holder = myid;
      window.party.broadcast({ t: 'plgrab', who: p.id });
      begindrag(p, e.clientX, e.clientY);

      const move = (ev) => movedrag(p, ev.clientX, ev.clientY);
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        enddrag(p, ev.clientX, ev.clientY);
        window.players.checkkill(p, ev.clientX, ev.clientY);
        p.holder = p.id;
        window.party.broadcast({ t: 'plrelease', who: p.id });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function binddrag(o) {
    o.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      claim(o);

      if (o.frozen) {
        const pos = o.body.position;
        const offx = e.clientX - pos.x, offy = e.clientY - pos.y;

        window.dragging = true;
        window.overlay.playeractive?.(true);

        const move = (ev) => {
          Body.setPosition(o.body, { x: ev.clientX - offx, y: ev.clientY - offy });
          draw(o);
          window.party.broadcast({
            t: 'objstate', id: o.id,
            x: o.body.position.x / window.innerWidth,
            y: o.body.position.y / window.innerHeight,
            rot: o.body.angle, vx: 0, vy: 0, w: 0, frozen: true
          });
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          window.dragging = false;
          window.overlay.playeractive?.(false);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return;
      }

      begindrag(o, e.clientX, e.clientY);
      window.party.broadcast({ t: 'objgrab', id: o.id });

      const move = (ev) => movedrag(o, ev.clientX, ev.clientY);
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);

        const v = enddrag(o, ev.clientX, ev.clientY);
        if (v) {
          window.party.broadcast({
            t: 'objrelease', id: o.id, vx: v.x, vy: v.y, w: o.body.angularVelocity
          });
        }
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  function share(o) {
    const p = o.body.position, v = o.body.velocity;
    window.party.broadcast({
      t: 'objstate', id: o.id,
      x: p.x / window.innerWidth, y: p.y / window.innerHeight,
      rot: o.body.angle, vx: v.x, vy: v.y, w: o.body.angularVelocity
    });
  }

  let selected = null;
  let marquee = null;
  let sizing = false;
  const arms = [];

  function select(o) {
    if (selected === o) return;
    deselect();
    selected = o;

    marquee = document.createElement('div');
    marquee.className = 'marquee';
    layer.appendChild(marquee);
    paintselection();
  }

  function deselect() {
    endresize();
    marquee?.remove();
    marquee = null;
    selected = null;
  }

  function paintselection() {
    if (!selected || !marquee) return;
    const pad = 7;
    const w = selected.hw * 2 + pad * 2;
    const h = selected.hh * 2 + pad * 2;
    marquee.style.width = w + 'px';
    marquee.style.height = h + 'px';
    marquee.style.transform =
      `translate(${(selected.body.position.x - w / 2).toFixed(1)}px, ${(selected.body.position.y - h / 2).toFixed(1)}px) ` +
      `rotate(${(selected.body.angle * 180 / Math.PI).toFixed(2)}deg)`;
  }

  function beginresize() {
    if (!selected || sizing) return;
    sizing = true;

    ['x', 'y'].forEach(axis => {
      const line = document.createElement('div');
      line.className = `axisline axis${axis}`;
      const knob = document.createElement('div');
      knob.className = `axis axis${axis} interactive`;
      knob.textContent = axis === 'x' ? '↔' : '↕';
      handles.append(line, knob);
      arms.push({ axis, line, knob });
      bindarm(arms[arms.length - 1]);
    });

    paintarms();
  }

  function endresize() {
    sizing = false;
    arms.splice(0).forEach(a => { a.line.remove(); a.knob.remove(); });
  }

  function armreach(o, axis) {
    return (axis === 'x' ? o.hw : o.hh) + 34;
  }

  function paintarms() {
    if (!selected || !sizing) return;
    const pos = selected.body.position;
    const angle = selected.body.angle;

    arms.forEach(a => {
      const dir = a.axis === 'x' ? angle : angle - Math.PI / 2;
      const reach = armreach(selected, a.axis);
      const x = pos.x + Math.cos(dir) * reach;
      const y = pos.y + Math.sin(dir) * reach;

      a.knob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      a.line.style.width = reach + 'px';
      a.line.style.transform =
        `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) rotate(${(dir * 180 / Math.PI).toFixed(2)}deg)`;
    });
  }

  function bindarm(arm) {
    arm.knob.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!selected) return;
      const o = selected;
      claim(o);

      window.dragging = true;
      window.overlay.playeractive?.(true);

      const move = (ev) => {
        const pos = o.body.position;
        const angle = o.body.angle;
        const dir = arm.axis === 'x' ? angle : angle - Math.PI / 2;
        const dx = ev.clientX - pos.x;
        const dy = ev.clientY - pos.y;
        const along = Math.abs(dx * Math.cos(dir) + dy * Math.sin(dir)) - 34;

        if (arm.axis === 'x') resize(o, along, o.hh);
        else resize(o, o.hw, along);

        paintselection();
        paintarms();
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        window.dragging = false;
        window.overlay.playeractive?.(false);
        window.party.broadcast({ t: 'objsize', id: o.id, hw: o.hw, hh: o.hh });
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  let lastshare = 0;
  let lasttime = 0;

  function tick(now) {
    try {
      const dt = lasttime ? Math.min(33, now - lasttime) : 16.7;
      lasttime = now;

      objects.forEach(o => {
        if (o.mine && o.until && now > o.until && !o.dragging) o.until = 0;
      });

      const people = window.players?.bodies?.() || [];
      people.forEach(p => drive(p));

      Engine.update(engine, dt);

      people.forEach(p => {
        recover(p.body);
        window.players.render(p);
      });
      objects.forEach(o => draw(o));

      paintselection();
      paintarms();

      if (now - lastshare > broadcastms) {
        lastshare = now;
        objects.forEach(o => {
          if (!o.mine || o.frozen || o.body.isSleeping) return;
          share(o);
        });
      }
    } catch (err) {
      console.error('[physics] frame error:', err);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function spawn(shape, atx, aty) {
    if (objects.size >= maxobjects) return null;
    const id = uid();
    const color = window.party.colorfor(myid);
    const x = atx ?? (window.innerWidth / 2 + (Math.random() - 0.5) * 260);
    const y = aty ?? 120;

    const o = make(id, shape, color, myid, x, y);
    Body.setVelocity(o.body, { x: (Math.random() - 0.5) * 4, y: 0 });
    Body.setAngularVelocity(o.body, (Math.random() - 0.5) * 0.1);

    window.party.broadcast({
      t: 'objnew', id, shape, color,
      x: x / window.innerWidth, y: y / window.innerHeight
    });
    return o;
  }

  function clearmine() {
    [...objects.values()].filter(o => o.mine).forEach(o => remove(o.id));
  }

  function pick(x, y) {
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest?.('.phys-obj');
    if (!hit) return null;
    for (const o of objects.values()) if (o.el === hit) return o;
    return null;
  }

  window.party?.onmessage((from, m) => {
    if (m.t === 'objnew') {
      if (objects.has(m.id)) return;
      make(m.id, m.shape, m.color, from,
        m.x * window.innerWidth, m.y * window.innerHeight, m.hw, m.hh);
    }
    else if (m.t === 'objclaim') {
      const o = objects.get(m.id);
      if (!o) return;
      o.owner = from;
      o.until = 0;
    }
    else if (m.t === 'objstate') {
      const o = objects.get(m.id);
      if (!o || o.dragging) return;
      if (o.mine && o.until > performance.now()) return;
      o.owner = from;
      if (!o.frozen) Sleeping.set(o.body, false);
      Body.setPosition(o.body, {
        x: m.x * window.innerWidth,
        y: m.y * window.innerHeight
      });
      Body.setAngle(o.body, m.rot);
      if (!o.frozen) {
        Body.setVelocity(o.body, { x: m.vx, y: m.vy });
        Body.setAngularVelocity(o.body, m.w);
      }
      draw(o);
    }
    else if (m.t === 'objdel') remove(m.id, true);
    else if (m.t === 'objfreeze') {
      const o = objects.get(m.id);
      if (o) freeze(o, !!m.on);
    }
    else if (m.t === 'objsize') {
      const o = objects.get(m.id);
      if (o) resize(o, m.hw, m.hh);
    }
    else if (m.t === 'objgrab') {
      const o = objects.get(m.id);
      if (!o) return;
      o.owner = from;
      if (!o.frozen) Sleeping.set(o.body, false);
    }
    else if (m.t === 'objrelease') {
      const o = objects.get(m.id);
      if (!o || o.dragging || o.frozen) return;
      Sleeping.set(o.body, false);
      Body.setVelocity(o.body, { x: m.vx, y: m.vy });
      Body.setAngularVelocity(o.body, m.w);
    }
  });

  window.overlay.onidentity(({ userid }) => { myid = userid; });

  window.overlay.onroster(({ members }) => {
    const set = new Set(members || []);
    objects.forEach(o => {
      if (!set.has(o.owner) && o.owner !== myid) claim(o);
    });
  });

  function snapshot() {
    return [...objects.values()].map(o => ({
      id: o.id, shape: o.shape, color: o.color, owner: o.owner,
      hw: o.hw, hh: o.hh,
      x: o.body.position.x, y: o.body.position.y,
      angle: o.body.angle, frozen: o.frozen
    }));
  }

  function wipe() {
    [...objects.keys()].forEach(id => remove(id, true));
  }

  function restore(list) {
    (list || []).forEach(d => {
      if (objects.has(d.id)) return;
      const o = make(d.id, d.shape, d.color, d.owner, d.x, d.y, d.hw, d.hh);
      Body.setAngle(o.body, d.angle);
      Body.setVelocity(o.body, { x: 0, y: 0 });
      Body.setAngularVelocity(o.body, 0);
      if (d.frozen) freeze(o, true);
      draw(o);
    });
  }

  window.physics = {
    count: () => objects.size,
    snapshot,
    wipe,
    restore,
    shapes: () => Object.keys(shapes),
    spawn,
    clearmine,
    pick,
    select,
    deselect,
    beginresize,
    endresize,

    freeze(o, on) {
      claim(o);
      freeze(o, on);
      window.party.broadcast({ t: 'objfreeze', id: o.id, on });
    },

    destroy(o) { remove(o.id); },

    attachbody(p, x, y) {
      attachbody(p, x, y);
      bindplayerdrag(p);
    },
    detachbody,
    begindrag,
    movedrag,
    enddrag(p, x, y) {
      enddrag(p, x, y);
      window.players.checkkill(p, x, y);
    },
    applyremote,

    onpeer(id) {
      objects.forEach(o => {
        if (!o.mine) return;
        const p = o.body.position;
        window.party.sendto(id, {
          t: 'objnew', id: o.id, shape: o.shape, color: o.color,
          hw: o.hw, hh: o.hh,
          x: p.x / window.innerWidth, y: p.y / window.innerHeight
        });
        if (o.frozen) window.party.sendto(id, { t: 'objfreeze', id: o.id, on: true });
      });
    },

    rebuildink: queueink
  };
})();
