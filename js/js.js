// TODO: 
// Resize canvas when window is resized
// Drawing Tools

const canvas = document.querySelector('#skrblz');
const canvasContext = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

canvasContext.strokeStyle = '#FFFFFF';
canvasContext.lineJoin = 'round';
canvasContext.lineCap = 'round';
canvasContext.lineWidth = 20;
let drawing = false;

let finalX = 0;
let finalY = 0;
let lineHue = 0;

function draw(e) {
	if (!drawing) return;
	canvasContext.beginPath();
	canvasContext.moveTo(finalX, finalY);
	canvasContext.lineTo(e.offsetX, e.offsetY);
	canvasContext.stroke();
	canvasContext.strokeStyle = `hsl(${lineHue}, 100%, 50%)`;
	finalX = e.offsetX;
	finalY = e.offsetY;
	lineHue++;
	console.log("pointer down");
}

// canvas.addEventListener('mousemove', draw);
// canvas.addEventListener('mouseup', () => drawing = false);
// canvas.addEventListener('mouseout', () => drawing = false);
// canvas.addEventListener('mousedown', (e) => {
// 		drawing = true
// 		finalX = e.offsetX;
// 		finalY = e.offsetY;
// 	}
// );

canvas.addEventListener('pointermove', draw);
canvas.addEventListener('pointerup', () => drawing = false);
canvas.addEventListener('pointerdown', (e) => {
		drawing = true
		finalX = e.offsetX;
		finalY = e.offsetY;
		console.log("pointer down");
	}
);

function clearCanvas() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	canvasContext.strokeStyle = '#000';
	canvasContext.lineJoin = 'round';
	canvasContext.lineCap = 'round';
	canvasContext.lineWidth = 20;
}