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
        await pc.setLocalDescription();
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
    }
    if (entry.audiosender && audio) {
      entry.audiosender.replaceTrack(audio).catch(e => console.warn('audio swap failed:', e));
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

        await entry.pc.setLocalDescription();
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
    doing = a.details ? `${a.app} — ${a.details}` : a.app;
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
