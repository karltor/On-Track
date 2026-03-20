// --- TÅG MINIGAME LOGIK ---
let gameScore = 0;
let highScore = parseInt(localStorage.getItem('train_hs')) || 0;
let globalT = 0; 
let trackSwitch = "blue"; 
let activePath = "blue"; 
let obstacle = { pos: 2.0, x: 600, y: 70 }; 
let baseSpeed = 0.013; 
let speed = baseSpeed;
let gameLoopId = null;
let isPlaying = false;

export function toggleSwitch() {
    trackSwitch = trackSwitch === "blue" ? "yellow" : "blue";
    const btn = document.getElementById('switchBtn');
    if(btn) {
        btn.className = `w-full py-4 border-b-4 rounded-2xl font-black text-2xl active:scale-[0.98] transition-all shadow-lg focus:outline-none ${trackSwitch === 'blue' ? 'bg-blue-500 border-blue-700 hover:bg-blue-400 text-white' : 'bg-yellow-400 border-yellow-600 hover:bg-yellow-300 text-slate-900'}`;
        btn.innerText = trackSwitch === 'blue' ? "VÄXEL: BLÅ (UPP) ↗️" : "VÄXEL: GUL (NER) ↘️";
    }
}

function getBezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const x = u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x;
    const y = u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y;
    return {x, y};
}

function getTrainPos(gT, pathColor) {
    const seg = Math.floor(gT);
    const t = gT - seg;
    if (pathColor === 'blue') {
        if(seg === 0) return {x: 300 + 200*t, y: 150}; 
        if(seg === 1) return getBezier({x:500,y:150}, {x:550,y:150}, {x:550,y:70}, {x:600,y:70}, t); 
        if(seg === 2) return {x: 600 + 80*Math.cos(-Math.PI/2 + Math.PI*t), y: 150 + 80*Math.sin(-Math.PI/2 + Math.PI*t)}; 
        if(seg === 3) return getBezier({x:600,y:230}, {x:550,y:230}, {x:550,y:150}, {x:500,y:150}, t); 
        if(seg === 4) return {x: 500 - 200*t, y: 150}; 
        if(seg === 5) return getBezier({x:300,y:150}, {x:250,y:150}, {x:250,y:70}, {x:200,y:70}, t); 
        if(seg === 6) return {x: 200 + 80*Math.cos(-Math.PI/2 - Math.PI*t), y: 150 + 80*Math.sin(-Math.PI/2 - Math.PI*t)}; 
        if(seg === 7) return getBezier({x:200,y:230}, {x:250,y:230}, {x:250,y:150}, {x:300,y:150}, t); 
    } else { 
        if(seg === 0) return {x: 300 + 200*t, y: 150}; 
        if(seg === 1) return getBezier({x:500,y:150}, {x:550,y:150}, {x:550,y:230}, {x:600,y:230}, t); 
        if(seg === 2) return {x: 600 + 80*Math.cos(Math.PI/2 - Math.PI*t), y: 150 + 80*Math.sin(Math.PI/2 - Math.PI*t)}; 
        if(seg === 3) return getBezier({x:600,y:70}, {x:550,y:70}, {x:550,y:150}, {x:500,y:150}, t); 
        if(seg === 4) return {x: 500 - 200*t, y: 150}; 
        if(seg === 5) return getBezier({x:300,y:150}, {x:250,y:150}, {x:250,y:230}, {x:200,y:230}, t); 
        if(seg === 6) return {x: 200 + 80*Math.cos(Math.PI/2 + Math.PI*t), y: 150 + 80*Math.sin(Math.PI/2 + Math.PI*t)}; 
        if(seg === 7) return getBezier({x:200,y:70}, {x:250,y:70}, {x:250,y:150}, {x:300,y:150}, t); 
    }
    return {x:300, y:150}; 
}

function spawnObstacle(side) {
    const isTop = Math.random() > 0.5;
    if (side === 'right') {
        obstacle = isTop ? { pos: 2.0, x: 600, y: 70 } : { pos: 2.0, x: 600, y: 230 }; 
    } else {
        obstacle = isTop ? { pos: 6.0, x: 200, y: 70 } : { pos: 6.0, x: 200, y: 230 }; 
    }
}

export function startMinigame() {
    isPlaying = true;
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    runGame();
}

export function stopMinigame() {
    isPlaying = false;
    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
        gameLoopId = null;
    }
}

function runGame() {
    if (!isPlaying) return;
    
    const canvas = document.getElementById('gameCanvas');
    if(!canvas) return; // Exit if canvas is no longer in the DOM
    const ctx = canvas.getContext('2d');
    
    let prevT = globalT;
    globalT += speed;
    
    if (globalT >= 8.0) { globalT -= 8.0; activePath = trackSwitch; }
    if (prevT < 4.0 && globalT >= 4.0) { activePath = trackSwitch; }
    
    if (prevT < 2.5 && globalT >= 2.5) {
        gameScore++; speed += 0.002;
        spawnObstacle('left'); 
        if(gameScore > highScore) { highScore = gameScore; localStorage.setItem('train_hs', highScore); }
    }
    if (prevT < 6.5 && globalT >= 6.5) {
        gameScore++; speed += 0.002;
        spawnObstacle('right'); 
        if(gameScore > highScore) { highScore = gameScore; localStorage.setItem('train_hs', highScore); }
    }

    let trainP = getTrainPos(globalT, activePath);

    if (Math.hypot(trainP.x - obstacle.x, trainP.y - obstacle.y) < 25) {
        gameScore = 0; speed = baseSpeed; globalT = 0; activePath = trackSwitch;
        spawnObstacle('right'); 
    }

    ctx.clearRect(0, 0, 800, 300);
    
    ctx.strokeStyle = "#475569"; ctx.lineWidth = 14; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(300, 150); ctx.lineTo(500, 150); ctx.stroke();

    ctx.strokeStyle = "#3b82f6";
    ctx.beginPath(); ctx.moveTo(500, 150); ctx.bezierCurveTo(550, 150, 550, 70, 600, 70); ctx.arc(600, 150, 80, -Math.PI/2, 0); ctx.stroke();
    ctx.strokeStyle = "#eab308";
    ctx.beginPath(); ctx.arc(600, 150, 80, 0, Math.PI/2); ctx.bezierCurveTo(550, 230, 550, 150, 500, 150); ctx.stroke();

    ctx.strokeStyle = "#3b82f6";
    ctx.beginPath(); ctx.moveTo(300, 150); ctx.bezierCurveTo(250, 150, 250, 70, 200, 70); ctx.arc(200, 150, 80, -Math.PI/2, Math.PI, true); ctx.stroke();
    ctx.strokeStyle = "#eab308";
    ctx.beginPath(); ctx.arc(200, 150, 80, Math.PI, Math.PI/2, true); ctx.bezierCurveTo(250, 230, 250, 150, 300, 150); ctx.stroke();
    
    ctx.fillStyle = "#ef4444";
    ctx.beginPath(); ctx.arc(300, 150, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(500, 150, 8, 0, Math.PI*2); ctx.fill();

    ctx.font = "30px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("📦", obstacle.x, obstacle.y);

    ctx.font = "40px Arial";
    ctx.fillText("🚂", trainP.x, trainP.y);
    
    const sDisplay = document.getElementById('scoreDisplay');
    if(sDisplay) sDisplay.innerText = gameScore;
    const hsDisplay = document.getElementById('hsDisplay');
    if(hsDisplay) hsDisplay.innerText = highScore;

    gameLoopId = requestAnimationFrame(runGame);
}
