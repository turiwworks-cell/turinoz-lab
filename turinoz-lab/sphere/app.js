'use strict';
const canvas = document.querySelector('#rive');
const surface = document.querySelector('#surface');
const panel = document.querySelector('#panel');
const recordPanel = document.querySelector('#record-panel');
const floatingControls = document.querySelector('#floating-controls');
const status = document.querySelector('#status');
const cursor = document.querySelector('#cursor');
const fields = [
  ['circleCount', 'number', '1'], ['circleSize', 'number', 'any'],
  ['sphereRadius', 'number', 'any'], ['autoSpeed', 'number', 'any'],
  ['rearOpacity', 'number', '0.01'],
  ['useShapes', 'boolean'], ['useNumbers', 'boolean'], ['usePhotos', 'boolean'], ['useColors', 'boolean'],
  ['circleColor', 'color'],
];
// Shapes, numbers and photos decide what each dot is, so only one can be on.
// Colours only tint dots, shapes and numbers; photos ignore them.
const DOT_MODES = ['useShapes', 'useNumbers', 'usePhotos'];
const scrubRanges = {
  circleCount: [1, 1000], circleSize: [2, 160],
  sphereRadius: [40, 500], autoSpeed: [-1000, 1000],
  rearOpacity: [-300, 300],
};
let player;
const bindings = new Map();
const inputs = new Map();
const scrubs = new Map();
for (const [name, type, step] of fields) {
  const row = document.createElement('div'); row.className = 'control';
  const label = document.createElement('label'); label.htmlFor = name; label.textContent = name;
  const input = document.createElement('input'); input.id = name;
  input.type = type === 'boolean' ? 'checkbox' : type;
  if (step) input.step = step;
  input.disabled = true; input.title = 'Not exposed in this Rive export';
  if (type === 'number') {
    row.classList.add('numeric');
    row.classList.add('floating-panel');
    row.dataset.panel = name;
    const head = document.createElement('header'); head.className = 'panel-handle';
    const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⋮⋮'; grip.setAttribute('aria-hidden', 'true');
    head.append(label, grip);
    const scrub = document.createElement('div'); scrub.className = 'scrub';
    scrub.setAttribute('role', 'slider'); scrub.setAttribute('tabindex', '0');
    scrub.setAttribute('aria-label', name); scrub.setAttribute('aria-valuemin', String(scrubRanges[name][0]));
    scrub.setAttribute('aria-valuemax', String(scrubRanges[name][1]));
    scrub.setAttribute('aria-valuenow', '0');
    scrub.innerHTML = '<span class="scrub-fill"></span><span class="scrub-thumb"></span>';
    scrub.setAttribute('aria-disabled', 'true');
    const body = document.createElement('div'); body.className = 'control-head'; body.append(input);
    row.append(head, body, scrub); scrubs.set(name, scrub);
    floatingControls.append(row);
  } else row.append(label, input);
  if (type !== 'number') document.querySelector('#controls').append(row);
  inputs.set(name, input);
}
function showError(message) { document.querySelector('#loading').textContent = message; status.textContent = message; }
function collect(instance, path = '', found = [], ancestors = new Set()) {
  if (!instance || ancestors.has(instance) || path.split('/').length > 12) return found;
  const seen = new Set(ancestors); seen.add(instance);
  for (const p of instance.properties) {
    if (p.type === 'viewModel') collect(instance.viewModel(p.name), path + p.name + '/', found, seen);
    else found.push({ name: p.name, path: path + p.name, type: p.type, owner: instance });
  }
  return found;
}
function paintPage(fallback) {
  try {
    const probe = paintPage.probe || (paintPage.probe = document.createElement('canvas'));
    probe.width = probe.height = 1;
    const g = probe.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 3, 3, 1, 1, 0, 0, 1, 1);
    const px = g.getImageData(0, 0, 1, 1).data;
    if (px[3] > 250) { document.documentElement.style.backgroundColor = `rgb(${px[0]},${px[1]},${px[2]})`; return; }
  } catch (_) {}
  if (fallback) document.documentElement.style.backgroundColor = fallback;
}
function connectControls() {
  const available = collect(player.viewModelInstance);
  for (const name of player.globalViewModelNames?.() || []) collect(player.globalViewModelInstance(name), name + '/', available);
  for (const [name, type] of fields) {
    const candidates = available.filter(p => p.name === name && p.type === type);
    if (candidates.length !== 1) continue;
    const entry = candidates[0];
    const property = entry.owner[type](name);
    if (!property) continue;
    bindings.set(name, property);
    const input = inputs.get(name); input.disabled = false; input.title = entry.path;
    const scrub = scrubs.get(name);
    if (scrub) {
      scrub.setAttribute('aria-disabled', 'false');
      scrub.setAttribute('role', 'slider');
      scrub.setAttribute('aria-label', name);
      scrub.parentElement.querySelector('.control-note')?.remove();
      const [min, max] = scrubRanges[name];
      const span = max - min;
      let drag = null, pending = null, frame = 0;
      const show = value => {
        const bounded = Math.min(max, Math.max(min, value));
        const entered = name === 'circleCount' ? Math.round(bounded) : Number(bounded.toFixed(2));
        input.value = String(entered);
        scrub.style.setProperty('--progress', `${(entered - min) / span * 100}%`);
        scrub.setAttribute('aria-valuenow', input.value);
        return entered;
      };
      const write = () => {
        frame = 0;
        if (pending === null) return;
        const value = pending; pending = null;
        property.value = value;
      };
      const set = value => {
        pending = show(value); // The thumb follows the pointer immediately.
        if (!frame) frame = requestAnimationFrame(write); // Only one Rive write per frame.
      };
      const paint = () => {
        if (drag || pending !== null) return;
        const value = property.value;
        scrub.style.setProperty('--progress', `${Math.max(0, Math.min(100, (value - min) / (max - min) * 100))}%`);
        scrub.setAttribute('aria-valuenow', Math.fround(Number(input.value)) === value ? input.value : String(value));
      };
      scrub.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); scrub.setPointerCapture(e.pointerId);
        const r = scrub.getBoundingClientRect();
        const thumbX = r.left + (property.value - min) / span * r.width;
        const raw = Math.abs(e.clientX - thumbX) <= 12 ? property.value : min + (e.clientX - r.left) / r.width * span;
        if (raw !== property.value) set(raw);
        drag = {id: e.pointerId, x: e.clientX, raw, width: r.width};
        scrub.classList.add('dragging');
      });
      scrub.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.id) return;
        const delta = e.clientX - drag.x; drag.x = e.clientX;
        if (delta) {
          drag.raw = Math.min(max, Math.max(min, drag.raw + delta / drag.width * span * (e.shiftKey ? 5 : 1)));
          set(drag.raw);
        }
      });
      const end = e => {
        if (drag?.id !== e.pointerId) return;
        drag = null; scrub.classList.remove('dragging');
        if (frame) cancelAnimationFrame(frame);
        write(); paint();
      };
      scrub.addEventListener('pointerup', end); scrub.addEventListener('pointercancel', end);
      scrub.addEventListener('lostpointercapture', end);
      scrub.addEventListener('keydown', e => {
        const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
        if (direction) { e.preventDefault(); set(property.value + direction * (name === 'circleCount' ? 1 : name === 'rearOpacity' ? 0.01 : span / 200) * (e.shiftKey ? 5 : 1)); }
        if (e.key === 'Home') { e.preventDefault(); set(min); }
        if (e.key === 'End') { e.preventDefault(); set(max); }
      });
      property.on(paint); paint();
    }
    const sync = () => {
      if (document.activeElement === input || (scrub && scrub.classList.contains('dragging'))) return;
      if (name === 'usePhotos') inputs.get('useColors')?.closest('.control')?.classList.toggle('muted', !!property.value);
      if (type === 'boolean') input.checked = property.value;
      else if (type === 'color') input.value = '#' + ((property.value >>> 0) & 0xffffff).toString(16).padStart(6, '0');
      else if (input.value === '' || Math.fround(Number(input.value)) !== property.value) input.value = String(property.value);
    };
    input.addEventListener('input', () => {
      if (type === 'boolean') {
        property.value = input.checked;
        if (input.checked && DOT_MODES.includes(name)) {
          for (const other of DOT_MODES) if (other !== name && bindings.get(other)?.value) bindings.get(other).value = false;
        }
      } else if (type === 'color') {
        // Rive uses packed ARGB. Preserve the file's existing alpha channel.
        property.value = (((property.value >>> 0) & 0xff000000) | parseInt(input.value.slice(1), 16)) >>> 0;
      } else {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value) || (name === 'circleCount' && !Number.isInteger(value))) return;
        property.value = value;
      }
    });
    input.addEventListener('blur', sync); property.on(sync); sync();
  }
  status.textContent = 'Ready · original Rive';
}
if (!window.rive) showError('Could not load the bundled Rive runtime. Check the vendor folder.');
else {
  const inl = window.__SPHERE_INLINE;
  rive.RuntimeLoader.setWasmUrl(inl ? inl.wasm : 'vendor/rive.wasm');
  rive.RuntimeLoader.setWasmFallbackUrl(inl ? inl.wasm : 'vendor/rive_fallback.wasm');
  player = new rive.Rive({
    ...(inl ? { buffer: Uint8Array.from(atob(inl.riv), c => c.charCodeAt(0)).buffer } : { src: 'sphere.riv' }), canvas, stateMachine: 'State Machine 1', autoplay: true, autoBind: true,
    layout: new rive.Layout({ fit: rive.Fit.FitWidth, alignment: rive.Alignment.TopCenter }),
    onLoad: () => {
      // Keep the drawing surface fixed at the recording resolution, independent of window size.
      player.resizeToCanvas();
      connectControls();
      resetUiState(false);
      // The script's 1.1 s introduction runs behind the loading screen.
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        paintPage();
        document.body.classList.add('ready');
        setTimeout(paintPage, 500);
      })), 1200);
    },
    onLoadError: () => showError('The Rive file could not load. Start the local server and open its address.'),
  });
}
const hint = document.querySelector('#hint');
let hintTimer;
function showHint(message) {
  hint.textContent = message; hint.classList.add('visible');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('visible'), 2400);
}
const panels = [...floatingControls.querySelectorAll('.floating-panel'), panel, recordPanel];
function place(panel, x, y) {
  panel.style.left = `${Math.max(8, Math.min(x, innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(y, innerHeight - panel.offsetHeight - 8))}px`;
}
function resetUiState(announce = true) {
  document.body.classList.remove('controls-hidden', 'controls-half', 'clean-mode');
  floatingControls.querySelectorAll('.floating-panel').forEach((p, i) => place(p, 16, 16 + i * 104));
  place(panel, innerWidth - panel.offsetWidth - 16, 16);
  place(recordPanel, innerWidth - recordPanel.offsetWidth - 16, innerHeight - recordPanel.offsetHeight - 16);
  if (announce) showHint('Control layout reset');
}
function makeDraggable(card) {
  const handle = card.querySelector('.panel-handle');
  let drag = null;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    drag = {id: e.pointerId, x: e.clientX - card.offsetLeft, y: e.clientY - card.offsetTop};
    card.classList.add('moving');
  });
  handle.addEventListener('pointermove', e => {
    if (drag?.id === e.pointerId) place(card, e.clientX - drag.x, e.clientY - drag.y);
  });
  const end = e => { if (drag?.id === e.pointerId) { drag = null; card.classList.remove('moving'); } };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
}
panels.forEach(makeDraggable);
window.addEventListener('resize', () => panels.forEach(p => place(p, p.offsetLeft, p.offsetTop)));
function togglePanel() {
  const hidden = document.body.classList.contains('controls-hidden');
  document.body.classList.remove('clean-mode');
  document.body.classList.toggle('controls-hidden', !hidden);
  if (!hidden) { document.activeElement?.blur(); showHint('H  show controls'); }
}
function toggleClean() {
  const clean = !document.body.classList.contains('clean-mode');
  document.body.classList.toggle('clean-mode', clean);
  document.body.classList.toggle('controls-hidden', clean);
  if (clean) { document.activeElement?.blur(); showHint('K  exit clean mode    ·    H  show controls'); }
}
function toggleOpacity() {
  const half = document.body.classList.toggle('controls-half');
  showHint(half ? 'Controls 50%' : 'Controls 100%');
}
async function fullscreen() {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); showHint('Fullscreen off'); }
    else { await document.documentElement.requestFullscreen(); showHint('Fullscreen on    ·    F to exit'); }
  }
  catch { showHint('Fullscreen blocked here. Use browser F11.'); }
}
document.querySelector('#hide').addEventListener('click', togglePanel);
document.querySelector('#clean').addEventListener('click', toggleClean);
document.querySelector('#fullscreen').addEventListener('click', fullscreen);
window.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.isContentEditable || e.target.tagName === 'TEXTAREA') return;
  const key = e.key.toLowerCase();
  if ('hfckor'.includes(key) && key.length === 1) e.preventDefault();
  if (key === 'h') togglePanel();
  if (key === 'k') toggleClean();
  if (key === 'c') resetUiState();
  if (key === 'o') toggleOpacity();
  if (key === 'f') fullscreen();
  if (key === 'r') toggleRecording();
});

const recordButton = document.querySelector('#record');
const recordDetail = document.querySelector('#record-detail');
const recordCursor = document.querySelector('#record-cursor');
const recordControls = document.querySelector('#record-controls');
let recorder = null, stream = null, chunks = [], recordingStarted = 0, downloadUrl = null;
let compositionFrame = 0;
const recordingPointer = {x: innerWidth / 2, y: innerHeight / 2, inside: false, down: false};
window.addEventListener('pointermove', e => {
  recordingPointer.x = e.clientX; recordingPointer.y = e.clientY;
  recordingPointer.inside = e.clientX >= 0 && e.clientY >= 0 && e.clientX < innerWidth && e.clientY < innerHeight;
}, {passive: true});
window.addEventListener('pointerdown', () => { recordingPointer.down = true; }, {passive: true});
window.addEventListener('pointerup', () => { recordingPointer.down = false; }, {passive: true});
window.addEventListener('pointercancel', () => { recordingPointer.down = false; }, {passive: true});
window.addEventListener('pointerout', e => { if (!e.relatedTarget) { recordingPointer.inside = false; recordingPointer.down = false; } });
window.addEventListener('blur', () => { recordingPointer.inside = false; recordingPointer.down = false; });
function recordingCard(ctx, element, sx, sy, scale) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  ctx.save();
  ctx.translate(rect.left * sx, rect.top * sy);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#1b1b1b';
  ctx.strokeStyle = '#ffffff1b';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(0, 0, rect.width, rect.height, 10); ctx.fill(); ctx.stroke();
  const head = element.querySelector('.panel-handle');
  const headRect = head.getBoundingClientRect();
  ctx.strokeStyle = '#ffffff14';
  ctx.beginPath(); ctx.moveTo(14, headRect.bottom - rect.top); ctx.lineTo(rect.width - 14, headRect.bottom - rect.top); ctx.stroke();
  ctx.font = '600 12px Inter, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#dedbd4'; ctx.textBaseline = 'middle';
  ctx.fillText(head.querySelector('label, strong').textContent, 14, headRect.top - rect.top + 8);
  ctx.font = '12px monospace'; ctx.fillStyle = '#73716d';
  ctx.fillText('⋮⋮', rect.width - 26, headRect.top - rect.top + 8);
  if (element.classList.contains('numeric')) {
    const input = element.querySelector('input');
    const box = input.getBoundingClientRect();
    const x = box.left - rect.left, y = box.top - rect.top;
    ctx.fillStyle = '#ffffff0b'; ctx.strokeStyle = '#ffffff18';
    ctx.beginPath(); ctx.roundRect(x, y, box.width, box.height, 5); ctx.fill(); ctx.stroke();
    ctx.font = '12px Consolas, monospace'; ctx.fillStyle = input.disabled ? '#777' : '#eeedea';
    ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y + 2, box.width - 8, box.height - 4); ctx.clip();
    ctx.textAlign = 'right'; ctx.fillText(input.value || '—', x + box.width - 6, y + box.height / 2);
    ctx.restore();
    const scrub = element.querySelector('.scrub');
    const line = scrub.getBoundingClientRect();
    const start = line.left - rect.left, end = line.right - rect.left, lineY = line.top - rect.top + 10;
    ctx.fillStyle = '#ffffff24'; ctx.fillRect(start, lineY, end - start, 2);
    if (scrub.getAttribute('aria-disabled') !== 'true') {
      const progress = Math.max(0, Math.min(1, parseFloat(scrub.style.getPropertyValue('--progress')) / 100 || 0));
      ctx.fillStyle = '#d9bfa0'; ctx.fillRect(start, lineY, (end - start) * progress, 2);
      ctx.fillStyle = '#252421'; ctx.strokeStyle = '#e5d4bf'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(start + (end - start) * progress, lineY + 1, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      const note = element.querySelector('.control-note');
      if (note) { ctx.font = '10px Inter, Arial, sans-serif'; ctx.fillStyle = '#8a8884'; ctx.fillText(note.textContent, 14, rect.height - 10); }
    }
  } else {
    for (const row of element.querySelectorAll('.control')) {
      const rowRect = row.getBoundingClientRect();
      const label = row.querySelector('label');
      const input = row.querySelector('input');
      const centerY = rowRect.top - rect.top + rowRect.height / 2;
      ctx.font = '12px Inter, "Segoe UI", Arial, sans-serif'; ctx.fillStyle = '#c9c9c6';
      ctx.fillText(label.textContent, 14, centerY);
      const inputRect = input.getBoundingClientRect();
      const ix = inputRect.left - rect.left, iy = inputRect.top - rect.top;
      if (input.type === 'color') {
        ctx.fillStyle = '#ffffff0b'; ctx.strokeStyle = '#ffffff26';
        ctx.beginPath(); ctx.roundRect(ix, iy, inputRect.width, inputRect.height, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = input.value; ctx.fillRect(ix + 3, iy + 3, inputRect.width - 6, inputRect.height - 6);
      } else {
        ctx.fillStyle = input.checked ? '#dedbd4' : '#272727'; ctx.strokeStyle = '#aaa';
        ctx.beginPath(); ctx.roundRect(ix, iy, inputRect.width, inputRect.height, 3); ctx.fill(); ctx.stroke();
        if (input.checked) { ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ix + 3, iy + 7); ctx.lineTo(ix + 6, iy + 10); ctx.lineTo(ix + 12, iy + 4); ctx.stroke(); }
      }
    }
  }
  ctx.restore();
}
function recordingFrame(ctx, showCursor, showControls, output) {
  ctx.fillStyle = '#131313'; ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(canvas, 0, 0, output.width, output.height);
  const sx = output.width / innerWidth, sy = output.height / innerHeight;
  const scale = Math.min(sx, sy);
  if (showControls && !document.body.classList.contains('controls-hidden')) {
    ctx.save();
    ctx.globalAlpha = document.body.classList.contains('controls-half') ? .5 : 1;
    for (const card of floatingControls.querySelectorAll('.floating-panel')) recordingCard(ctx, card, sx, sy, scale);
    recordingCard(ctx, panel, sx, sy, scale);
    ctx.restore();
  }
  if (showCursor && recordingPointer.inside) {
    const x = recordingPointer.x * sx, y = recordingPointer.y * sy;
    const down = recordingPointer.down || cursor.classList.contains('down');
    ctx.save();
    ctx.fillStyle = down ? '#ffffff24' : 'transparent';
    ctx.strokeStyle = '#f3f0e9'; ctx.lineWidth = 1.25 * scale;
    ctx.beginPath(); ctx.arc(x, y, (down ? 9.4 : 12) * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (down) { ctx.fillStyle = '#ffffffb3'; ctx.beginPath(); ctx.arc(x, y, 5 * scale, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  compositionFrame = requestAnimationFrame(() => recordingFrame(ctx, showCursor, showControls, output));
}
function recordingType() {
  return ['video/mp4;codecs=avc1.64002A', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type));
}
function toggleRecording() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!document.body.classList.contains('ready')) return;
  if (!canvas.captureStream || !window.MediaRecorder) { recordDetail.textContent = 'Recording is unavailable in this browser.'; return; }
  try {
    const type = recordingType();
    const showCursor = recordCursor.checked, showControls = recordControls.checked;
    let source = canvas;
    if (showCursor || showControls) {
      source = document.createElement('canvas');
      source.width = canvas.width; source.height = canvas.height;
      const context = source.getContext('2d', {alpha: false});
      if (!context) throw new Error('Canvas composition is unavailable');
      recordingFrame(context, showCursor, showControls, source);
    }
    stream = source.captureStream(60);
    chunks = [];
    recorder = new MediaRecorder(stream, { ...(type ? {mimeType: type} : {}), videoBitsPerSecond: 64_000_000 });
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onerror = () => { recordDetail.textContent = 'Recording failed. Try Chrome or Edge.'; };
    recorder.onstop = () => {
      cancelAnimationFrame(compositionFrame); compositionFrame = 0;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      recordCursor.disabled = false; recordControls.disabled = false;
      recordButton.classList.remove('recording'); recordButton.innerHTML = 'Record master <kbd>R</kbd>';
      const mime = recorder.mimeType || type || 'video/webm';
      const extension = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, {type: mime});
      if (!blob.size) { recordDetail.textContent = 'No video was captured. Try Chrome or Edge.'; return; }
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl; link.download = `sphere-master-1600x1200-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
      link.textContent = `Download ${extension.toUpperCase()} master`;
      link.className = 'download-link';
      recordDetail.replaceChildren(link);
      link.click();
      showHint(`Recording ready · ${Math.round((performance.now() - recordingStarted) / 1000)} s`);
    };
    recorder.start(1000);
    recordCursor.disabled = true; recordControls.disabled = true;
    recordingStarted = performance.now();
    recordButton.classList.add('recording'); recordButton.innerHTML = 'Stop recording <kbd>R</kbd>';
    recordDetail.textContent = 'Recording 1600 × 1200 · up to 60 fps';
    showHint('Recording · R to stop');
  } catch (error) {
    cancelAnimationFrame(compositionFrame); compositionFrame = 0;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    recordCursor.disabled = false; recordControls.disabled = false;
    recordDetail.textContent = `Recording could not start: ${error.message}`;
  }
}
recordButton.addEventListener('click', toggleRecording);
// The full-viewport transparent surface forwards native coordinates to Rive.
// The Rive file and its scripted interaction remain unchanged.
let press = null, holdTimer, throwTimer, lastPoint = {clientX: innerWidth / 2, clientY: innerHeight / 2};
function action(name) { document.querySelectorAll('[data-action]').forEach(el => el.classList.toggle('active', el.dataset.action === name)); }
function forward(type, point) {
  if (!document.body.classList.contains('ready')) return;
  const r = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, point.clientX / innerWidth));
  const y = Math.max(0, Math.min(1, point.clientY / innerHeight));
  // Map the full viewport onto the script's existing 1200 × 900 hit region.
  const clientX = r.left + r.width * (.125 + .75 * x);
  const clientY = r.top + r.height * (.125 + .75 * y);
  canvas.dispatchEvent(new MouseEvent(type, {clientX, clientY, button: 0, bubbles: false}));
}
function finishPointer(forced = false, e = lastPoint) {
  if (!press) return;
  forward('mouseup', e);
  if (forced) forward('mouseout', e);
  const thrown = !forced && press.dragged && press.speed > .08 && performance.now() - press.lastTime < 100;
  press = null; clearTimeout(holdTimer); cursor.classList.remove('down'); action(thrown ? 'throw' : null);
  if (thrown) { clearTimeout(throwTimer); throwTimer = setTimeout(() => action(null), 750); }
  const inViewport = e.clientX >= 0 && e.clientY >= 0 && e.clientX < innerWidth && e.clientY < innerHeight;
  const overSurface = !forced && inViewport && document.elementFromPoint(e.clientX, e.clientY) === surface;
  cursor.classList.toggle('visible', overSurface);
  cursor.classList.toggle('over', overSurface);
  if (forced) { clearTimeout(throwTimer); action(null); }
}
surface.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') cursor.classList.add('visible'); });
surface.addEventListener('pointerdown', e => {
  if (press || e.button !== 0 || !document.body.classList.contains('ready')) return;
  e.preventDefault();
  lastPoint = {clientX: e.clientX, clientY: e.clientY};
  surface.setPointerCapture(e.pointerId);
  forward('mousedown', e);
  clearTimeout(throwTimer); action(null); cursor.classList.add('down');
  press = {id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, lastTime: performance.now(), speed: 0, dragged: false};
  holdTimer = setTimeout(() => { if (press && !press.dragged) action('hold'); }, 180);
});
surface.addEventListener('pointermove', e => {
  lastPoint = {clientX: e.clientX, clientY: e.clientY};
  const overSurface = document.elementFromPoint(e.clientX, e.clientY) === surface;
  cursor.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0)`;
  cursor.classList.toggle('visible', e.pointerType !== 'touch' && overSurface);
  cursor.classList.toggle('over', overSurface);
  if (press && e.pointerId === press.id && !overSurface) { finishPointer(true, e); return; }
  if (!overSurface) return;
  forward('mousemove', e);
  if (!press || e.pointerId !== press.id) return;
  const now = performance.now();
  press.speed = Math.hypot(e.clientX - press.lastX, e.clientY - press.lastY) / Math.max(1, now - press.lastTime);
  press.lastX = e.clientX; press.lastY = e.clientY; press.lastTime = now;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) { press.dragged = true; clearTimeout(holdTimer); action('drag'); }
}, {passive: true});
window.addEventListener('pointerup', e => { if (press?.id === e.pointerId) finishPointer(false, e); });
window.addEventListener('pointercancel', e => { if (press?.id === e.pointerId) finishPointer(true, e); });
surface.addEventListener('lostpointercapture', e => { if (press?.id === e.pointerId) finishPointer(true, lastPoint); });
surface.addEventListener('pointerleave', e => {
  if (press) finishPointer(true, e);
  else { forward('mouseout', e); cursor.classList.remove('visible', 'over'); }
});
window.addEventListener('pointerout', e => { if (!e.relatedTarget) finishPointer(true, lastPoint); });
window.addEventListener('mouseout', e => { if (!e.relatedTarget) finishPointer(true, lastPoint); });
window.addEventListener('blur', () => finishPointer(true, lastPoint));
document.addEventListener('visibilitychange', () => { if (document.hidden) finishPointer(true, lastPoint); });
