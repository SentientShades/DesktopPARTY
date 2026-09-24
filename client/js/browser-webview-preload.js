const { ipcRenderer } = require('electron');

function pathfor(node) {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentNode;
    const index = Array.prototype.indexOf.call(parent.childNodes, node) + 1;
    return pathfor(parent) + `/text()[${index}]`;
  }
  if (node === document.body) return '/html/body';
  if (!node.parentNode) return '';

  let index = 1;
  let sib = node.previousSibling;
  while (sib) {
    if (sib.nodeType === 1 && sib.tagName === node.tagName) index++; // only count same tag siblings
    sib = sib.previousSibling;
  }
  return pathfor(node.parentNode) + `/${node.tagName.toLowerCase()}[${index}]`;
}

function nodefor(path) {
  try {
    const r = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue;
  } catch { return null; }
}

let applying = false; // guards against feedback loop when we apply a remote scroll/selection

document.addEventListener('scroll', () => {
  if (applying) return;
  ipcRenderer.sendToHost('bw:scroll', { x: window.scrollX, y: window.scrollY });
}, { passive: true, capture: true });

document.addEventListener('selectionchange', () => {
  if (applying) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    ipcRenderer.sendToHost('bw:selection', null);
    return;
  }
  try {
    const range = sel.getRangeAt(0);

    ipcRenderer.sendToHost('bw:selection', {
      anchorpath: pathfor(range.startContainer),
      anchoroffset: range.startOffset,
      focuspath: pathfor(range.endContainer),
      focusoffset: range.endOffset,
      text: sel.toString().slice(0, 400) // cap payload size
    });
  } catch {}
});

ipcRenderer.on('bw:apply-scroll', (_e, { x, y }) => {
  applying = true;
  window.scrollTo(x, y);
  setTimeout(() => { applying = false; }, 50);
});

ipcRenderer.on('bw:apply-selection', (_e, sel) => {
  applying = true;
  try {
    const target = window.getSelection();
    target.removeAllRanges();
    if (sel) {
      const anchor = nodefor(sel.anchorpath);
      const focus = nodefor(sel.focuspath);
      if (anchor && focus) {
        const range = document.createRange();
        const amax = anchor.length ?? anchor.childNodes.length;
        const fmax = focus.length ?? focus.childNodes.length;

        range.setStart(anchor, Math.min(sel.anchoroffset, amax));
        range.setEnd(focus, Math.min(sel.focusoffset, fmax));
        target.addRange(range);
      }
    }
  } catch {}
  setTimeout(() => { applying = false; }, 50);
});


let syncing = false;
const watched = new WeakSet(); // avoid double binding listeners on rescan

function attach(v) {
  if (watched.has(v)) return;
  watched.add(v);

  v.addEventListener('play', () => {
    if (syncing) return;
    ipcRenderer.sendToHost('bw:video', { action: 'play', at: v.currentTime });
  });

  v.addEventListener('pause', () => {
    if (syncing) return;
    ipcRenderer.sendToHost('bw:video', { action: 'pause', at: v.currentTime });
  });

  v.addEventListener('seeked', () => {
    if (syncing) return;
    ipcRenderer.sendToHost('bw:video', { action: 'seek', at: v.currentTime });
  });
}

function scan() {
  document.querySelectorAll('video').forEach(attach);
}

scan();
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true }); ///// catches lazy loaded players

ipcRenderer.on('bw:apply-video', (_e, { action, at }) => {
  const v = document.querySelector('video');
  if (!v) return;
  syncing = true;

  if (Math.abs(v.currentTime - at) > 0.6) v.currentTime = at; // small drift tolerance, avoid jitter!!
  if (action === 'play') v.play().catch(() => {});
  if (action === 'pause') v.pause();

  setTimeout(() => { syncing = false; }, 150);
});

ipcRenderer.on('bw:request-video-state', () => {
  const v = document.querySelector('video');
  if (!v) return;
  ipcRenderer.sendToHost('bw:video', {
    action: v.paused ? 'pause' : 'play',
    at: v.currentTime
  });
});
