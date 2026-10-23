// Skrblz — drawing canvas, brush dock, sounds, undo, export and resize handling

const canvas = document.querySelector('#skrblz');
const ctx = canvas.getContext('2d');

// ---------- Brush settings ----------

const INK = '#1f1f1d';

const SIZES = {
	small: 6,
	medium: 14,
	large: 28,
};

const brush = {
	color: 'rainbow', // 'rainbow' | 'ink'
	size: 'medium',   // key of SIZES
	hue: 0,
};

function strokeColor() {
	return brush.color === 'rainbow' ? `hsl(${brush.hue}, 100%, 50%)` : INK;
}

// Context settings are reset whenever the canvas is resized, so they live in one place.
function applyBrush() {
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.lineWidth = SIZES[brush.size];
	ctx.strokeStyle = strokeColor();
}

// ---------- Sounds ----------
// UI sounds from uisfx.com ("zen" feel, CC0). Volumes are the library's own per-sound defaults.
// Browsers only allow audio after the person interacts with the page, so the AudioContext is
// created on the first pointer or key press.

const SOUNDS = {
	select: { src: 'sounds/select.mp3', volume: 0.2 },  // color swatches
	typing: { src: 'sounds/typing.mp3', volume: 0.2 }, // stroke sizes
};

let audio = null;
const soundData = {};    // name → Promise<ArrayBuffer>
const soundBuffers = {}; // name → Promise<AudioBuffer>

for (const [name, { src }] of Object.entries(SOUNDS)) {
	soundData[name] = fetch(src).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
}

function unlockAudio() {
	if (audio) return;
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	if (!AudioCtx) return;
	audio = new AudioCtx();
	for (const name of Object.keys(SOUNDS)) {
		soundBuffers[name] = soundData[name]
			.then((data) => (data ? audio.decodeAudioData(data.slice(0)) : null))
			.catch(() => null);
	}
}

window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });

// Fallback for when Web Audio can't load the files — e.g. index.html opened straight from
// Finder (a file:// URL), where browsers block fetch(). An <audio> element still works there.
const fallbackEls = {};

function playFallback(name) {
	const { src, volume } = SOUNDS[name];
	fallbackEls[name] ??= new Audio(src);
	const el = fallbackEls[name].cloneNode(); // a fresh copy so quick repeat clicks can overlap
	el.volume = volume;
	el.play().catch(() => {});
}

async function playSound(name) {
	unlockAudio();
	if (!audio) return playFallback(name);
	if (audio.state === 'suspended') audio.resume();
	const buffer = await soundBuffers[name];
	if (!buffer) return playFallback(name);
	const source = audio.createBufferSource();
	const gain = audio.createGain();
	gain.gain.value = SOUNDS[name].volume;
	source.buffer = buffer;
	source.connect(gain).connect(audio.destination);
	source.start();
}

// ---------- History ----------
// Every stroke is recorded so the canvas can be redrawn at any time — after an undo,
// or after a window resize (so nothing gets cropped).
// Each action: { type: 'stroke', width, points: [{ x, y, c }] } | { type: 'clear' }

const actions = []; // undo history
let currentStroke = null;

function drawSegment(x0, y0, x1, y1, color) {
	ctx.strokeStyle = color; // set before stroking so each segment gets its own color
	ctx.beginPath();
	ctx.moveTo(x0, y0);
	ctx.lineTo(x1, y1);
	ctx.stroke();
}

function wipe() {
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.restore();
}

// Index of the first action after the most recent clear — everything before it is off-screen.
function visibleStart() {
	for (let i = actions.length - 1; i >= 0; i--) {
		if (actions[i].type === 'clear') return i + 1;
	}
	return 0;
}

function render() {
	wipe();
	for (let i = visibleStart(); i < actions.length; i++) {
		const action = actions[i];
		if (action.type !== 'stroke') continue;
		ctx.lineWidth = action.width;
		const pts = action.points;
		for (let j = 0; j < pts.length; j++) {
			const from = pts[j - 1] || pts[j];
			drawSegment(from.x, from.y, pts[j].x, pts[j].y, pts[j].c);
		}
	}
	applyBrush();
}

const undoButton = document.querySelector('#undo');

// Dim the undo button when there's nothing to undo.
function updateUndoButton() {
	undoButton.setAttribute('aria-disabled', String(actions.length === 0));
}

function undo() {
	if (drawing || !actions.length) return;
	actions.pop();
	render();
	updateUndoButton();
}

undoButton.addEventListener('click', undo);

// ---------- Canvas sizing ----------

function sizeCanvas() {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(window.innerWidth * dpr);
	canvas.height = Math.round(window.innerHeight * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	render();
}

let resizeQueued = false;
window.addEventListener('resize', () => {
	if (resizeQueued) return;
	resizeQueued = true;
	requestAnimationFrame(() => {
		resizeQueued = false;
		sizeCanvas();
	});
});

// ---------- Drawing ----------

let drawing = false;

function addPoint(x, y) {
	const pts = currentStroke.points;
	const prev = pts[pts.length - 1] || { x, y };
	const c = strokeColor();
	drawSegment(prev.x, prev.y, x, y, c);
	pts.push({ x, y, c });
}

canvas.addEventListener('pointerdown', (e) => {
	if (e.pointerType === 'mouse' && e.button !== 0) return;
	drawing = true;
	document.body.classList.add('is-drawing');
	canvas.setPointerCapture(e.pointerId);
	currentStroke = { type: 'stroke', width: SIZES[brush.size], points: [] };
	actions.push(currentStroke);
	updateUndoButton();
	addPoint(e.clientX, e.clientY); // a tap/click leaves a dot
});

canvas.addEventListener('pointermove', (e) => {
	if (!drawing) return;
	// Coalesced events give smoother lines on fast strokes and pens.
	const points = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
	if (points.length) {
		for (const p of points) addPoint(p.clientX, p.clientY);
	} else {
		addPoint(e.clientX, e.clientY);
	}
	if (brush.color === 'rainbow') brush.hue = (brush.hue + 1) % 360;
});

function stopDrawing() {
	drawing = false;
	currentStroke = null;
	document.body.classList.remove('is-drawing');
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('lostpointercapture', stopDrawing);

// ---------- Clear ----------

function clearCanvas() {
	// Nothing on screen → don't add an empty step to undo through.
	if (visibleStart() === actions.length) return;
	actions.push({ type: 'clear' }); // recorded, so undo can bring the drawing back
	updateUndoButton();
	brush.hue = 0;
	render();
}

document.querySelector('#clear').addEventListener('click', clearCanvas);

// ---------- Export ----------

function exportPNG() {
	// The canvas is transparent; flatten it onto white so the PNG looks like what's on screen.
	const out = document.createElement('canvas');
	out.width = canvas.width;
	out.height = canvas.height;
	const outCtx = out.getContext('2d');
	outCtx.fillStyle = '#ffffff';
	outCtx.fillRect(0, 0, out.width, out.height);
	outCtx.drawImage(canvas, 0, 0);

	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	const name = `skrblz-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;

	out.toBlob((blob) => {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}, 'image/png');
}

document.querySelector('#export').addEventListener('click', exportPNG);

// ---------- Dock ----------

const colorButtons = document.querySelectorAll('[data-color]');
const sizeButtons = document.querySelectorAll('[data-size]');

function setColor(color) {
	if (brush.color === color) return; // no sound or work when it's already selected
	brush.color = color;
	playSound('select');
	colorButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
	applyBrush();
}

function setSize(size) {
	if (brush.size === size) return;
	brush.size = size;
	playSound('typing');
	sizeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
	applyBrush();
}

colorButtons.forEach((b) => b.addEventListener('click', () => setColor(b.dataset.color)));
sizeButtons.forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));

// Clicking a dock button with the mouse shouldn't leave a focus ring or keep its tooltip pinned.
document.querySelectorAll('.dock-item').forEach((b) => {
	b.addEventListener('pointerup', (e) => { if (e.pointerType !== 'keyboard') b.blur(); });
});

// ---------- Keyboard shortcuts ----------

const SHORTCUTS = {
	'1': () => setColor('rainbow'),
	'2': () => setColor('ink'),
	s: () => setSize('small'),
	m: () => setSize('medium'),
	l: () => setSize('large'),
	z: undo,
};

window.addEventListener('keydown', (e) => {
	const t = e.target;
	if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
	// ⌘Z / Ctrl+Z also undo, since that's muscle memory.
	if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
		e.preventDefault();
		undo();
		return;
	}
	// Leave every other ⌘/Ctrl/Alt combo (⌘S, ⌘L, ⌘M…) to the browser and OS.
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	const action = SHORTCUTS[e.key.toLowerCase()];
	if (action) {
		e.preventDefault();
		action();
	}
});

// ---------- Init ----------

sizeCanvas();
