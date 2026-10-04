// Spectra host page: loads spectra.riv with the official Rive web runtime
// (vendor/, @rive-app/webgl2 2.43.1) and records the canvas to WebM.
// Keys: R starts/stops recording, H hides/shows the controls.

(() => {
  const SRC = 'spectra.riv';
  const STATE_MACHINE = 'State Machine 1';

  const ARTBOARD_W = 960; // artboard is 960x680 (24:17)
  const STEP_W = 48, STEP_H = 34; // smallest even-sized 24:17 frame, so recordings never letterbox
  const GUTTER_X = 16, GUTTER_Y = 64; // room for the controls under the stage
  const FPS = 60;
  const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  const canvas = document.getElementById('stage');
  const recButton = document.getElementById('rec');
  const recLabel = document.getElementById('recLabel');
  const timeText = document.getElementById('time');
  const metaText = document.getElementById('meta');
  const toggle = document.getElementById('toggle');

  let riv = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let clock = 0;
  let noteTimer = 0;

  // Layout

  // The drawing buffer is always a whole multiple of 48x34 device pixels and is
  // shown 1:1, so the WebM gets the canvas's native pixels at the artboard's exact
  // aspect. While recording, only the CSS box follows the window.
  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(innerWidth - GUTTER_X * 2, STEP_W);
    const availH = Math.max(innerHeight - GUTTER_Y * 2, STEP_H);
    let cssW, cssH;
    if (recorder) {
      const s = Math.min(availW / canvas.width, availH / canvas.height);
      cssW = canvas.width * s;
      cssH = canvas.height * s;
    } else {
      const m = Math.max(1, Math.floor(Math.min(availW / STEP_W, availH / STEP_H) * dpr));
      const w = STEP_W * m, h = STEP_H * m;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (riv) {
          riv.devicePixelRatioUsed = dpr;
          riv.resizeToCanvas();
        }
      }
      cssW = w / dpr;
      cssH = h / dpr;
    }
    const snap = v => Math.round(v * dpr) / dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.style.left = snap((innerWidth - cssW) / 2) + 'px';
    canvas.style.top = snap((innerHeight - cssH) / 2) + 'px';
    document.body.style.setProperty('--cursor', cursorFor(cssW / ARTBOARD_W));
    if (!recorder) showMeta();
  }

  // Cursor

  // Outside the canvas the page uses the arrow spectra.riv draws inside it:
  // arrowPath() at CURSOR.scale, layered as in drawCursor() with the dark palette
  // (soft shadow, dark halo, white fill).
  const ARROW = 'M0 0L18.6 8.2L9.6 11.2L5.2 19Z';
  const CURSOR_SCALE = 0.9;
  const CURSOR_BOX = 26; // arrow + halo + shadow, in arrow units
  const CURSOR_PAD = 2;

  function cursorFor(stageScale) {
    // Chrome drops custom cursors larger than 32px when they touch the browser UI.
    const k = Math.min(CURSOR_SCALE * stageScale, 32 / CURSOR_BOX);
    const size = Math.round(CURSOR_BOX * k);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-CURSOR_PAD} ${-CURSOR_PAD} ${CURSOR_BOX} ${CURSOR_BOX}" ` +
      `stroke-linejoin="round" stroke-linecap="round">` +
      `<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter>` +
      `<path d="${ARROW}" transform="translate(${(1 / CURSOR_SCALE).toFixed(2)} ${(2 / CURSOR_SCALE).toFixed(2)})" fill="#000" fill-opacity=".35" filter="url(#s)"/>` +
      `<path d="${ARROW}" fill="none" stroke="#0b0b0c" stroke-opacity=".9" stroke-width="3"/>` +
      `<path d="${ARROW}" fill="#fff" stroke="#fff" stroke-width="1.4"/>` +
      `</svg>`;
    const hot = Math.round((CURSOR_PAD * size) / CURSOR_BOX);
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot} ${hot}, default`;
  }

  // Rive

  fit();
  if (!window.rive) return note("Couldn't load the Rive runtime", 0);
  rive.RuntimeLoader.setWasmUrl('vendor/rive.wasm');
  rive.RuntimeLoader.setWasmFallbackUrl('vendor/rive_fallback.wasm');

  riv = new rive.Rive({
    src: SRC,
    canvas,
    stateMachine: STATE_MACHINE,
    autoplay: true,
    autoBind: true,
    layout: new rive.Layout({ fit: rive.Fit.Contain, alignment: rive.Alignment.Center }),
    // Draw every frame so the capture stream never stalls.
    drawingOptions: rive.DrawOptimizationOptions.AlwaysDraw,
    onLoad: () => {
      riv.devicePixelRatioUsed = window.devicePixelRatio || 1;
      riv.resizeToCanvas();
      canvas.classList.add('live');
      recButton.disabled = !recordType();
      showMeta();
      bindClipboard();
    },
    // Browsers block the .riv and runtime from file://, hence Start.cmd.
    onLoadError: () => note(location.protocol === 'file:' ? 'Open Spectra with Start.cmd' : `Couldn't load ${SRC}`, 0),
  });

  // spectra.riv can't reach the clipboard, so its script publishes copies through
  // the view model (`copiedHex` + `copied`) when the file defines them.
  function bindClipboard() {
    const vm = riv.viewModelInstance;
    if (!vm) return;
    const names = vm.properties.map(p => p.name);
    if (!names.includes('copiedHex') || !names.includes('copied')) return;
    const hex = vm.string('copiedHex');
    vm.trigger('copied').on(() => navigator.clipboard?.writeText(hex.value).catch(() => {}));
  }

  // Recording

  function recordType() {
    if (!window.MediaRecorder || !canvas.captureStream) return '';
    return TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function start() {
    const type = recordType();
    if (!type || !riv) return;
    fit();
    const stream = canvas.captureStream(FPS);
    const bits = canvas.width * canvas.height * FPS * 0.15;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: type,
        videoBitsPerSecond: Math.round(Math.min(Math.max(bits, 8e6), 40e6)),
      });
      recorder.start(1000);
    } catch (err) {
      recorder = null;
      stream.getTracks().forEach(t => t.stop());
      note(`Couldn't start recording: ${err.message}`);
      return;
    }
    chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => save(stream, type);
    startedAt = performance.now();
    clock = setInterval(tick, 250);
    tick();
    document.body.classList.add('recording');
    document.title = '● REC · Spectra';
    recLabel.textContent = 'Stop';
    recButton.title = 'Stop recording (R)';
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  async function save(stream, type) {
    const ms = performance.now() - startedAt;
    stream.getTracks().forEach(t => t.stop());
    clearInterval(clock);
    const size = `${canvas.width}×${canvas.height}`;
    recorder = null;
    document.body.classList.remove('recording');
    document.title = 'Spectra';
    recLabel.textContent = 'Record';
    recButton.title = 'Record (R)';
    fit();

    const blob = await withDuration(new Blob(chunks, { type: type.split(';')[0] }), ms);
    chunks = [];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectra-${stamp()}-${size.replace('×', 'x')}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    note(`Saved ${size} · ${bytes(blob.size)}`);
  }

  function tick() {
    const s = Math.floor((performance.now() - startedAt) / 1000);
    timeText.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  }

  // MediaRecorder writes WebM without a Duration, so most players can't seek it.
  // Insert one into Segment > Info. Leaves the file untouched if it can't do so safely.
  async function withDuration(blob, ms) {
    const HEAD = 4096;
    try {
      const head = patchDuration(new Uint8Array(await blob.slice(0, HEAD).arrayBuffer()), ms);
      return head ? new Blob([head, blob.slice(HEAD)], { type: blob.type }) : blob;
    } catch {
      return blob;
    }
  }

  function patchDuration(b, ms) {
    const vint = (i, isId) => {
      if (i >= b.length) return null;
      let len = 1;
      while (len <= 8 && !(b[i] & (0x80 >> (len - 1)))) len++;
      if (len > 8 || i + len > b.length) return null;
      let value = isId ? b[i] : b[i] & (0xff >> len);
      let unknown = value === 0xff >> len;
      for (let k = 1; k < len; k++) {
        value = value * 256 + b[i + k];
        unknown = unknown && b[i + k] === 0xff;
      }
      return { value, len, unknown: !isId && unknown };
    };
    const element = i => {
      const id = vint(i, true);
      const size = id && vint(i + id.len, false);
      return size && { id: id.value, size, start: i + id.len + size.len };
    };

    const ebml = element(0);
    if (!ebml || ebml.id !== 0x1a45dfa3) return null;
    const segment = element(ebml.start + ebml.size.value);
    if (!segment || segment.id !== 0x18538067 || !segment.size.unknown) return null;

    for (let i = segment.start; i < b.length;) {
      const el = element(i);
      if (!el || el.size.unknown) return null;
      // Anything that stores byte offsets would be broken by the insert.
      if (el.id === 0x114d9b74 || el.id === 0x1c53bb6b) return null;
      if (el.id !== 0x1549a966) {
        i = el.start + el.size.value;
        continue;
      }
      const end = el.start + el.size.value;
      if (end > b.length) return null;
      let scale = 1e6;
      for (let j = el.start; j < end;) {
        const child = element(j);
        if (!child) return null;
        if (child.id === 0x4489) return null; // already has a Duration
        if (child.id === 0x2ad7b1) {
          scale = 0;
          for (let k = 0; k < child.size.value; k++) scale = scale * 256 + b[child.start + k];
        }
        j = child.start + child.size.value;
      }
      const sizeAt = el.start - el.size.len;
      const newSize = el.size.value + 11;
      if (!scale || newSize >= 2 ** (7 * el.size.len) - 1) return null;

      const out = new Uint8Array(b.length + 11);
      out.set(b.subarray(0, end));
      out.set([0x44, 0x89, 0x88], end);
      new DataView(out.buffer).setFloat64(end + 3, (ms * 1e6) / scale);
      out.set(b.subarray(end), end + 11);
      for (let k = el.size.len - 1, v = newSize; k >= 0; k--, v = Math.floor(v / 256)) out[sizeAt + k] = v % 256;
      out[sizeAt] |= 0x80 >> (el.size.len - 1);
      return out;
    }
    return null;
  }

  // Controls

  function showMeta() {
    if (noteTimer) return;
    metaText.textContent = recordType()
      ? `${canvas.width}×${canvas.height} · ${FPS} fps`
      : 'WebM recording is not supported in this browser';
  }

  function note(text, ms = 4000) {
    clearTimeout(noteTimer);
    metaText.textContent = text;
    noteTimer = ms ? setTimeout(() => { noteTimer = 0; showMeta(); }, ms) : -1;
  }

  function setClean(on) {
    document.body.classList.toggle('clean', on);
    toggle.textContent = on ? 'Show' : 'Hide';
    toggle.title = on ? 'Show controls (H)' : 'Hide controls (H)';
  }

  const pad = n => String(n).padStart(2, '0');
  const bytes = n => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const stamp = (d = new Date()) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  recButton.addEventListener('click', () => (recorder ? stop() : start()));
  toggle.addEventListener('click', () => setClean(!document.body.classList.contains('clean')));
  window.addEventListener('keydown', e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = (e.key || '').toLowerCase();
    if (key === 'r' && !recButton.disabled) recorder ? stop() : start();
    else if (key === 'h') toggle.click();
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', fit);
  (function watchPixelRatio() {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener('change', () => { fit(); watchPixelRatio(); }, { once: true });
  })();
})();
