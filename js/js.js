const canvas = document.querySelector('#skrblz');
const ctx = canvas.getContext('2d');

// ---------- Brush settings ----------

const INK = '#1f1f1d';

const SIZES = {
	small: 6,
	medium: 14,
	large: 28,
};

// Colors in the popover
const PALETTE = [
	{ id: 'pink',     name: 'Pink',     hex: '#FE60B8' },
	{ id: 'green',    name: 'Green',    hex: '#4CC342' },
	{ id: 'sky',      name: 'Sky',      hex: '#7ECDF0' },
	{ id: 'crimson',  name: 'Crimson',  hex: '#B91A45' },
	{ id: 'purple',   name: 'Purple',   hex: '#672E91' },
	{ id: 'blue',     name: 'Blue',     hex: '#1E71EA' },
	{ id: 'orange',   name: 'Orange',   hex: '#FF743E' },
	{ id: 'forest',   name: 'Forest',   hex: '#177525' },
	{ id: 'yellow',   name: 'Yellow',   hex: '#F3DC3D' },
	{ id: 'red',      name: 'Red',      hex: '#ED3546' },
	{ id: 'lavender', name: 'Lavender', hex: '#C566FF' },
	{ id: 'rainbow',  name: 'Rainbow' },
];

const brush = {
	color: 'palette',       // 'palette' (the popover slot) | 'ink' (black)
	paletteColor: 'rainbow', // id from PALETTE — what the slot is set to
	size: 'medium',          // key of SIZES
	hue: 0,
};

const paletteEntry = (id) => PALETTE.find((c) => c.id === id);

function strokeColor() {
	if (brush.color === 'ink') return INK;
	if (brush.paletteColor === 'rainbow') return `hsl(${brush.hue}, 100%, 50%)`;
	return paletteEntry(brush.paletteColor).hex;
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
// created on the first pointer or key press

const SOUNDS = {
	select:   { src: 'sounds/select.mp3',   volume: 0.2 }, // colors, sizes, export
	typing:   { src: 'sounds/typing.mp3',   volume: 0.2 }, // hovering toolbar buttons
	hover:    { src: 'sounds/hover.mp3',    volume: 0.1 }, // hovering colors in the popover
	reaction: { src: 'sounds/reaction.mp3', volume: 0.2 }, // clearing the canvas
	uncheck:  { src: 'sounds/uncheck.mp3',  volume: 0.2 }, // undo
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
// Finder (a file:// URL), where browsers block fetch(). An <audio> element still works there
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
const clearButton = document.querySelector('#clear');
const exportButton = document.querySelector('#export');

const canvasIsEmpty = () => visibleStart() === actions.length;

// Dim Undo when there's nothing to undo, and Clear/Export when nothing's on the canvas
function updateActionButtons() {
	undoButton.setAttribute('aria-disabled', String(actions.length === 0));
	clearButton.setAttribute('aria-disabled', String(canvasIsEmpty()));
	exportButton.setAttribute('aria-disabled', String(canvasIsEmpty()));
}

function undo() {
	if (drawing || !actions.length) return;
	actions.pop();
	render();
	updateActionButtons();
	playSound('uncheck');
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
	updateActionButtons();
	addPoint(e.clientX, e.clientY); // a tap/click leaves a dot
});

canvas.addEventListener('pointermove', (e) => {
	if (!drawing) return;
	// Coalesced events give smoother lines on fast strokes and pens
	const points = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
	if (points.length) {
		for (const p of points) addPoint(p.clientX, p.clientY);
	} else {
		addPoint(e.clientX, e.clientY);
	}
	if (brush.color === 'palette' && brush.paletteColor === 'rainbow') brush.hue = (brush.hue + 1) % 360;
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
	if (drawing || canvasIsEmpty()) return;
	actions.push({ type: 'clear' }); // recorded, so undo can bring the drawing back
	updateActionButtons();
	playSound('reaction');
	brush.hue = 0;
	render();
}

clearButton.addEventListener('click', clearCanvas);

// ---------- Export ----------

function exportPNG() {
	if (canvasIsEmpty()) return; // nothing to save
	playSound('select');
	// The canvas is transparent; flatten it onto white so the PNG looks like what's on screen
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

exportButton.addEventListener('click', exportPNG);

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
	playSound('select');
	sizeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
	applyBrush();
}

document.querySelector('[data-color="ink"]').addEventListener('click', () => setColor('ink'));
sizeButtons.forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));

// ---------- Color popover ----------
// The first dock swatch is a "slot" that holds one palette color (Rainbow by default).
// Clicking it selects that color and opens the popover; key 1 selects it without opening

const slot = document.querySelector('#color-slot');
const slotWrap = slot.parentElement;
const slotSwatch = slot.querySelector('.swatch');
const slotTipLabel = slot.querySelector('.tip-label');
const palette = document.querySelector('#palette');

// Build the popover's swatches from PALETTE.
const paletteItems = PALETTE.map((c) => {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'palette-item';
	b.dataset.paletteColor = c.id;
	b.setAttribute('aria-label', c.name);
	b.setAttribute('aria-pressed', String(c.id === brush.paletteColor));
	b.tabIndex = c.id === brush.paletteColor ? 0 : -1; // arrow keys move within the grid
	const sw = document.createElement('span');
	sw.className = c.id === 'rainbow' ? 'swatch swatch--rainbow' : 'swatch';
	if (c.hex) sw.style.background = c.hex;
	b.append(sw);
	b.addEventListener('click', () => pickPaletteColor(c.id));
	b.addEventListener('pointerenter', hoverSound('hover'));
	palette.append(b);
	return b;
});

// Hover sounds: popover colors play 'hover', toolbar buttons play 'typing'. Mouse/trackpad
// only — on touch screens a tap also counts as a hover, which would play it on top of the
// click sound. Dimmed buttons stay quiet, and a short gap keeps a fast sweep from buzzing
let lastHover = 0;
function hoverSound(name) {
	return (e) => {
		if (e.pointerType === 'touch') return;
		if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
		const now = performance.now();
		if (now - lastHover < 40) return;
		lastHover = now;
		playSound(name);
	};
}

// Show the slot's current color on its swatch, tooltip and label.
function updateSlot() {
	const c = paletteEntry(brush.paletteColor);
	slotSwatch.classList.toggle('swatch--rainbow', c.id === 'rainbow');
	slotSwatch.style.background = c.hex || '';
	slotTipLabel.textContent = c.name;
	slot.setAttribute('aria-label', `Color: ${c.name}`);
	paletteItems.forEach((b) => {
		const on = b.dataset.paletteColor === c.id;
		b.setAttribute('aria-pressed', String(on));
		b.tabIndex = on ? 0 : -1;
	});
}

function pickPaletteColor(id) {
	const changed = brush.paletteColor !== id || brush.color !== 'palette';
	brush.paletteColor = id;
	brush.color = 'palette';
	if (changed) playSound('select');
	colorButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === 'palette')));
	updateSlot();
	applyBrush();
	closePalette({ returnFocus: palette.contains(document.activeElement) });
}

const isPaletteOpen = () => !palette.hidden;

function openPalette() {
	palette.hidden = false;
	slotWrap.classList.add('is-open');
	slot.setAttribute('aria-expanded', 'true');
	// Keep it on-screen on narrow phones (it's centered on the swatch, which sits near the dock's edge).
	// Measured from the swatch and the popover's layout width, since the open animation scales it
	const s = slot.getBoundingClientRect();
	const w = palette.offsetWidth;
	const left = s.left + s.width / 2 - w / 2;
	const margin = 8;
	let shift = 0;
	if (left < margin) shift = margin - left;
	else if (left + w > window.innerWidth - margin) shift = window.innerWidth - margin - (left + w);
	palette.style.setProperty('--shift', `${shift}px`);
	paletteItems.find((b) => b.tabIndex === 0).focus({ preventScroll: true });
}

function closePalette({ returnFocus = false } = {}) {
	if (!isPaletteOpen()) return;
	palette.hidden = true;
	slotWrap.classList.remove('is-open');
	slot.setAttribute('aria-expanded', 'false');
	if (returnFocus) slot.focus({ preventScroll: true });
}

slot.addEventListener('click', () => {
	if (isPaletteOpen()) return closePalette();
	setColor('palette');
	openPalette();
});

// Arrow keys move through the 4-wide grid; Esc closes
const COLS = 4;
palette.addEventListener('keydown', (e) => {
	const i = paletteItems.indexOf(document.activeElement);
	if (i === -1) return;
	const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
	let next = null;
	if (e.key in moves) next = i + moves[e.key];
	else if (e.key === 'Home') next = 0;
	else if (e.key === 'End') next = paletteItems.length - 1;
	if (next === null) return;
	e.preventDefault();
	e.stopPropagation();
	paletteItems[Math.max(0, Math.min(paletteItems.length - 1, next))].focus();
});

// Clicking or tapping anywhere else closes it. A tap on the canvas only closes it
document.addEventListener('pointerdown', (e) => {
	if (!isPaletteOpen() || slotWrap.contains(e.target)) return;
	closePalette();
	if (e.target === canvas) e.stopPropagation();
}, { capture: true });

// Tabbing out of the popover closes it too
slotWrap.addEventListener('focusout', (e) => {
	if (isPaletteOpen() && e.relatedTarget && !slotWrap.contains(e.relatedTarget)) closePalette();
});

// Clicking a dock button with the mouse shouldn't leave a focus ring or keep its tooltip pinned
document.querySelectorAll('.dock-item').forEach((b) => {
	b.addEventListener('pointerup', (e) => { if (e.pointerType !== 'keyboard') b.blur(); });
	b.addEventListener('pointerenter', hoverSound('typing'));
});

// ---------- Keyboard shortcuts ----------

const SHORTCUTS = {
	'1': () => setColor('palette'), // whatever color the slot holds
	'2': () => setColor('ink'),
	s: () => setSize('small'),
	m: () => setSize('medium'),
	l: () => setSize('large'),
	z: undo,
	c: clearCanvas,
	e: exportPNG,
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
	if (e.key === 'Escape' && isPaletteOpen()) {
		closePalette({ returnFocus: slotWrap.contains(document.activeElement) });
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
