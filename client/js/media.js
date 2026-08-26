(() => {
  let stage = null;
  let capture = null;
  let mode = 'none';

  async function broadcaststart(url) {
    const info = await window.overlay.stageopen(url);
    if (!info?.sourceid) throw new Error('Could not open the stage window');
    stage = info;

    const video = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: info.sourceid,
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 30
      }
    };

    try {
      capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      mode = capture.getAudioTracks().length ? 'frame' : 'framevideo';
      window.debuglog?.('out', 'capture', `stage frame (${mode}) — Discord excluded`);
    } catch (frameerr) {
      window.debuglog?.('out', 'capture', `frame capture failed (${frameerr.name}) — falling back`);
      try {
        capture = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop' } },
          video
        });
        mode = 'system';
        window.debuglog?.('out', 'capture', 'system audio — everything is shared');
      } catch (e) {
        window.debuglog?.('out', 'capture', `audio failed (${e.name}) — video only`);
        capture = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        mode = 'silent';
      }
    }

    window.party.addstream(capture);
    return capture;
  }

  function broadcaststop() {
    if (capture) {
      window.party.dropstream(capture);
      capture.getTracks().forEach(t => t.stop());
      capture = null;
      mode = 'none';
    }
    if (stage) {
      window.overlay.stageclose();
      stage = null;
    }
  }

  function stagego(url) {
    return window.overlay.stagego(url);
  }

  function stagesize() {
    return stage ? { w: stage.width, h: stage.height } : null;
  }

  function audiomode() { return mode; }

  function setmuted(on) {
    capture?.getAudioTracks().forEach(t => { t.enabled = !on; });
  }

  window.media = {
    stagesize,
    audiomode,
    setmuted,
    broadcaststart,
    broadcaststop,
    stagego,
    iscapturing: () => !!capture
  };
})();
