// Skrblz

// Settings

const INK = '#1f1f1d';

const SIZES = { small: 6, medium: 14, large: 28 };

const PALETTE = [
	{ id: 'pink', name: 'Pink', hex: '#FE60B8' },
	{ id: 'green', name: 'Green', hex: '#4CC342' },
	{ id: 'sky', name: 'Sky', hex: '#7ECDF0' },
	{ id: 'crimson', name: 'Crimson', hex: '#B91A45' },
	{ id: 'purple', name: 'Purple', hex: '#672E91' },
	{ id: 'blue', name: 'Blue', hex: '#1E71EA' },
	{ id: 'orange', name: 'Orange', hex: '#FF743E' },
	{ id: 'forest', name: 'Forest', hex: '#177525' },
	{ id: 'yellow', name: 'Yellow', hex: '#F3DC3D' },
	{ id: 'red', name: 'Red', hex: '#ED3546' },
	{ id: 'lavender', name: 'Lavender', hex: '#C566FF' },
	{ id: 'rainbow', name: 'Rainbow' },
];
const PALETTE_COLUMNS = 4;
const POPOVER_EDGE_MARGIN = 8;

// uisfx.com, "zen" pack
const SOUNDS = {
	select: { src: 'sounds/select.mp3', volume: 0.2 },
	typing: { src: 'sounds/typing.mp3', volume: 0.2 },
	hover: { src: 'sounds/hover.mp3', volume: 0.1 },
	reaction: { src: 'sounds/reaction.mp3', volume: 0.2 },
	uncheck: { src: 'sounds/uncheck.mp3', volume: 0.2 },
};
const HOVER_SOUND_MIN_GAP_MS = 40;

// Elements

const canvas = document.querySelector('#skrblz');
const ctx = canvas.getContext('2d');

const colorButtons = document.querySelectorAll('[data-color]');
const sizeButtons = document.querySelectorAll('[data-size]');
const inkButton = document.querySelector('[data-color="ink"]');
const undoButton = document.querySelector('#undo');
const clearButton = document.querySelector('#clear');
const exportButton = document.querySelector('#export');

const slot = document.querySelector('#color-slot');
const picker = slot.parentElement;
const slotSwatch = slot.querySelector('.swatch');
const slotTipLabel = slot.querySelector('.tip-label');
const palette = document.querySelector('#palette');

const about = document.querySelector('#about');
const aboutOpenButton = document.querySelector('#about-open');
const aboutCloseButton = document.querySelector('#about-close');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// State

const brush = {
	color: 'palette', // 'palette' (whatever the color slot holds)
	paletteColor: 'rainbow',
	size: 'medium',
	hue: 0,
};

const actions = [];
let currentStroke = null;
let drawing = false;
let resizeQueued = false;

let audio = null;
const soundData = {};
const soundBuffers = {};
const fallbackAudio = {};
let lastHoverSoundAt = 0;

let paletteItems = [];

// Audio

function loadSounds() {
	for (const [name, { src }] of Object.entries(SOUNDS)) {
		soundData[name] = fetch(src)
			.then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
			.catch((err) => {
				console.warn(`Couldn't load sound "${name}"`, err);
				return null;
			});
	}
}

function unlockAudio() {
	if (!audio) {
		const AudioCtx = window.AudioContext || window.webkitAudioContext;
		if (!AudioCtx) return;
		audio = new AudioCtx();
		for (const name of Object.keys(SOUNDS)) {
			soundBuffers[name] = soundData[name]
				.then((data) => data && audio.decodeAudioData(data.slice(0)))
				.catch((err) => {
					console.warn(`Couldn't decode sound "${name}"`, err);
					return null;
				});
		}
	}
	if (audio.state !== 'running') {
		audio.resume().catch((err) => console.warn('Audio resume failed', err));
		// Older iOS Safari only unlocks Web Audio once something plays during a tap.
		const silence = audio.createBufferSource();
		silence.buffer = audio.createBuffer(1, 1, audio.sampleRate);
		silence.connect(audio.destination);
		silence.start();
	}
}

function playWithAudioElement(name) {
	const { src, volume } = SOUNDS[name];
	fallbackAudio[name] ??= new Audio(src);
	const el = fallbackAudio[name].cloneNode();
	el.volume = volume;
	el.play().catch((err) => console.warn(`Couldn't play sound "${name}"`, err));
}

async function playSound(name) {
	unlockAudio();
	if (!audio) return playWithAudioElement(name);
	if (audio.state !== 'running') audio.resume().catch(() => {});
	const buffer = await soundBuffers[name];
	if (!buffer) return playWithAudioElement(name);
	const source = audio.createBufferSource();
	const gain = audio.createGain();
	gain.gain.value = SOUNDS[name].volume;
	source.buffer = buffer;
	source.connect(gain).connect(audio.destination);
	source.start();
}

function hoverSound(name) {
	return (e) => {
		// On touch screens a tap also fires pointerenter.
		if (e.pointerType === 'touch') return;
		if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
		const now = performance.now();
		if (now - lastHoverSoundAt < HOVER_SOUND_MIN_GAP_MS) return;
		lastHoverSoundAt = now;
		playSound(name);
	};
}

// Canvas

const paletteEntry = (id) => PALETTE.find((c) => c.id === id);

function strokeColor() {
	if (brush.color === 'ink') return INK;
	if (brush.paletteColor === 'rainbow') return `hsl(${brush.hue}, 100%, 50%)`;
	return paletteEntry(brush.paletteColor).hex;
}

function applyBrush() {
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.lineWidth = SIZES[brush.size];
	ctx.strokeStyle = strokeColor();
}

function drawSegment(x0, y0, x1, y1, color) {
	ctx.strokeStyle = color;
	ctx.beginPath();
	ctx.moveTo(x0, y0);
	ctx.lineTo(x1, y1);
	ctx.stroke();
}

function drawDot({ x, y, c }, width) {
	ctx.fillStyle = c;
	ctx.beginPath();
	ctx.arc(x, y, width / 2, 0, Math.PI * 2);
	ctx.fill();
}

const isDot = (points) => points.every((p) => p.x === points[0].x && p.y === points[0].y);

function drawStroke({ points, width }) {
	ctx.lineWidth = width;
	if (isDot(points)) return drawDot(points[0], width);
	points.forEach((p, i) => {
		const from = points[i - 1] || p;
		drawSegment(from.x, from.y, p.x, p.y, p.c);
	});
}

function clearPixels() {
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.restore();
}

// Index of the first action after the most recent clear.
function visibleStart() {
	for (let i = actions.length - 1; i >= 0; i--) {
		if (actions[i].type === 'clear') return i + 1;
	}
	return 0;
}

const canvasIsEmpty = () => visibleStart() === actions.length;

function render() {
	clearPixels();
	// Resizing a canvas resets its context, including line caps and joins.
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	for (const action of actions.slice(visibleStart())) {
		if (action.type === 'stroke') drawStroke(action);
	}
	applyBrush();
}

function sizeCanvas() {
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round(window.innerWidth * dpr);
	canvas.height = Math.round(window.innerHeight * dpr);
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	render();
}

function onResize() {
	if (resizeQueued) return;
	resizeQueued = true;
	requestAnimationFrame(() => {
		resizeQueued = false;
		sizeCanvas();
	});
}

// Drawing input

function addPoint(x, y) {
	const points = currentStroke.points;
	const prev = points[points.length - 1] || { x, y };
	const c = strokeColor();
	drawSegment(prev.x, prev.y, x, y, c);
	points.push({ x, y, c });
}

function startStroke(e) {
	if (e.pointerType === 'mouse' && e.button !== 0) return;
	drawing = true;
	document.body.classList.add('is-drawing');
	canvas.setPointerCapture(e.pointerId);
	currentStroke = { type: 'stroke', width: SIZES[brush.size], points: [] };
	actions.push(currentStroke);
	updateActionButtons();
	addPoint(e.clientX, e.clientY);
}

function continueStroke(e) {
	if (!drawing) return;
	const points = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
	if (points.length) {
		for (const p of points) addPoint(p.clientX, p.clientY);
	} else {
		addPoint(e.clientX, e.clientY);
	}
	if (brush.color === 'palette' && brush.paletteColor === 'rainbow') brush.hue = (brush.hue + 1) % 360;
}

function endStroke() {
	if (currentStroke && isDot(currentStroke.points)) drawDot(currentStroke.points[0], currentStroke.width);
	drawing = false;
	currentStroke = null;
	document.body.classList.remove('is-drawing');
}

// Undo, clear, export

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

function clearCanvas() {
	if (drawing || canvasIsEmpty()) return;
	actions.push({ type: 'clear' });
	updateActionButtons();
	playSound('reaction');
	brush.hue = 0;
	render();
}

function exportPNG() {
	if (canvasIsEmpty()) return;
	playSound('select');

	// Flatten canvas onto white background
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

// Brush controls

function setColor(color) {
	if (brush.color === color) return;
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

// Color popover

function buildPalette() {
	paletteItems = PALETTE.map((c) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'palette-item';
		b.dataset.paletteColor = c.id;
		b.setAttribute('aria-label', c.name);

		const swatch = document.createElement('span');
		swatch.className = c.hex ? 'swatch' : 'swatch swatch--rainbow';
		if (c.hex) {
			swatch.style.background = c.hex;
			swatch.style.setProperty('--ring', c.hex);
		}
		b.append(swatch);

		// detail is 0 when Enter/Space triggered the click.
		b.addEventListener('click', (e) => pickPaletteColor(c.id, { fromKeyboard: e.detail === 0 }));
		b.addEventListener('pointerenter', hoverSound('hover'));
		palette.append(b);
		return b;
	});
}

function updateSlot() {
	const c = paletteEntry(brush.paletteColor);
	slotSwatch.classList.toggle('swatch--rainbow', !c.hex);
	slotSwatch.style.background = c.hex || '';
	if (c.hex) slot.style.setProperty('--ring', c.hex);
	else slot.style.removeProperty('--ring');
	slotTipLabel.textContent = c.name;
	slot.setAttribute('aria-label', `Color: ${c.name}`);
	for (const b of paletteItems) {
		const selected = b.dataset.paletteColor === c.id;
		b.setAttribute('aria-pressed', String(selected));
		b.tabIndex = selected ? 0 : -1;
	}
}

function pickPaletteColor(id, { fromKeyboard = false } = {}) {
	const changed = brush.paletteColor !== id || brush.color !== 'palette';
	brush.paletteColor = id;
	brush.color = 'palette';
	if (changed) playSound('select');
	colorButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === 'palette')));
	updateSlot();
	applyBrush();
	closePalette({ returnFocus: fromKeyboard });
}

const isPaletteOpen = () => !palette.hidden;

function openPalette() {
	palette.hidden = false;
	picker.classList.add('is-open');
	slot.setAttribute('aria-expanded', 'true');

	const s = slot.getBoundingClientRect();
	const w = palette.offsetWidth;
	const left = s.left + s.width / 2 - w / 2;
	const maxRight = window.innerWidth - POPOVER_EDGE_MARGIN;
	let shift = 0;
	if (left < POPOVER_EDGE_MARGIN) shift = POPOVER_EDGE_MARGIN - left;
	else if (left + w > maxRight) shift = maxRight - (left + w);
	palette.style.setProperty('--shift', `${shift}px`);

	paletteItems.find((b) => b.tabIndex === 0).focus({ preventScroll: true });
}

function closePalette({ returnFocus = false } = {}) {
	if (!isPaletteOpen()) return;
	palette.hidden = true;
	picker.classList.remove('is-open');
	slot.setAttribute('aria-expanded', 'false');
	if (returnFocus) slot.focus({ preventScroll: true });
}

function toggleSlot() {
	if (isPaletteOpen()) return closePalette();
	setColor('palette');
	openPalette();
}

function navigatePalette(e) {
	const i = paletteItems.indexOf(document.activeElement);
	if (i === -1) return;
	const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: PALETTE_COLUMNS, ArrowUp: -PALETTE_COLUMNS };
	let next = null;
	if (e.key in steps) next = i + steps[e.key];
	else if (e.key === 'Home') next = 0;
	else if (e.key === 'End') next = paletteItems.length - 1;
	if (next === null) return;
	e.preventDefault();
	e.stopPropagation();
	paletteItems[Math.max(0, Math.min(paletteItems.length - 1, next))].focus();
}

function closePaletteOnOutsidePress(e) {
	if (!isPaletteOpen() || picker.contains(e.target)) return;
	closePalette();
	// Dismissing the popover by tapping the canvas shouldn't also draw
	if (e.target === canvas) e.stopPropagation();
}

// About modal

function openAbout() {
	about.classList.remove('is-closing');
	about.showModal();
}

function closeAbout() {
	if (!about.open || about.classList.contains('is-closing')) return;
	if (reducedMotion.matches) return about.close();
	about.classList.add('is-closing');
	about.addEventListener('animationend', () => {
		about.classList.remove('is-closing');
		about.close();
	}, { once: true });
}

// Keyboard shortcuts

const SHORTCUTS = {
	1: () => setColor('palette'),
	2: () => setColor('ink'),
	s: () => setSize('small'),
	m: () => setSize('medium'),
	l: () => setSize('large'),
	z: undo,
	c: clearCanvas,
	e: exportPNG,
};

function onKeydown(e) {
	if (about.open) return;
	const t = e.target;
	if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

	if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
		e.preventDefault();
		undo();
		return;
	}
	if (e.key === 'Escape' && isPaletteOpen()) {
		closePalette({ returnFocus: picker.contains(document.activeElement) });
		return;
	}
	if (e.metaKey || e.ctrlKey || e.altKey) return;

	const action = SHORTCUTS[e.key.toLowerCase()];
	if (action) {
		e.preventDefault();
		action();
	}
}

// Setup

loadSounds();
buildPalette();

// iOS Safari only lets audio start on a completed tap, not on touchstart/pointerdown.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
	window.addEventListener(type, unlockAudio, { capture: true, passive: true });
}

canvas.addEventListener('pointerdown', startStroke);
canvas.addEventListener('pointermove', continueStroke);
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('lostpointercapture', endStroke);
window.addEventListener('resize', onResize);

slot.addEventListener('click', toggleSlot);
inkButton.addEventListener('click', () => setColor('ink'));
sizeButtons.forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));
undoButton.addEventListener('click', undo);
clearButton.addEventListener('click', clearCanvas);
exportButton.addEventListener('click', exportPNG);

document.querySelectorAll('.dock-item').forEach((b) => {
	// Don't leave a focus ring or a pinned tooltip after a mouse click.
	b.addEventListener('pointerup', () => b.blur());
	b.addEventListener('pointerenter', hoverSound('typing'));
});

palette.addEventListener('keydown', navigatePalette);
document.addEventListener('pointerdown', closePaletteOnOutsidePress, { capture: true });
picker.addEventListener('focusout', (e) => {
	if (isPaletteOpen() && e.relatedTarget && !picker.contains(e.relatedTarget)) closePalette();
});

window.addEventListener('keydown', onKeydown);

aboutOpenButton.addEventListener('click', openAbout);
aboutCloseButton.addEventListener('click', closeAbout);
about.addEventListener('click', (e) => {
	if (e.target === about) closeAbout();
});
// Esc: animate out instead of closing instantly.
about.addEventListener('cancel', (e) => {
	e.preventDefault();
	closeAbout();
});

// touch-action: none covers Chrome; iOS Safari still pinch-zooms without these.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
	document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener(
	'touchmove',
	(e) => {
		if (e.touches.length > 1) e.preventDefault();
	},
	{ passive: false },
);

updateSlot();
sizeCanvas();
