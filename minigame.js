// --- ELLIPTISKT TÅG MINIGAME LOGIK ---
let gameScore = 0;
let highScore = parseInt(localStorage.getItem('train_hs')) || 0;

const cx = 400; // Mitten av canvas X
const cy = 150; // Mitten av canvas Y

// De exakta banorna tåget åker på (Rx och Ry definierar ellipsen)
const pathInner = { rx: 165, ry: 55 };
const pathOuter = { rx: 215, ry: 105 };

// Gränsväggarna (Gapet mellan dem är alltid exakt 50 i både x och y-led nu)
const wallInner = { rx: 140, ry: 30 };
const wallMid   = { rx: 190, ry: 80 };
const wallOuter = { rx: 240, ry: 130 };

let theta = Math.PI / 2; // Starta rakt ner i mitten
let baseVelocity = 2.5;  // Pixlar per frame istället för vinkelhastighet
let velocity = baseVelocity;

let targetTrack = 'inner';
let currentRx = pathInner.rx;
let currentRy = pathInner.ry;

let bomb = { track: 'outer', angle: Math.PI / 2 }; 
let gameLoopId = null;
let isPlaying = false;

function updateButtonUI() {
    const btn = document.getElementById('switchBtn');
    if(btn) {
        if (targetTrack === 'inner') {
            btn.className = "w-full py-4 border-b-4 border-blue-700 bg-blue-500 hover:bg-blue-400 text-white rounded-2xl font-black text-2xl active:scale-[0.98] transition-all shadow-lg focus:outline-none";
            btn.innerText = "SPÅR: INRE (BLÅTT) 🔄";
        } else {
            btn.className = "w-full py-4 border-b-4 border-red-700 bg-red-500 hover:bg-red-400 text-white rounded-2xl font-black text-2xl active:scale-[0.98] transition-all shadow-lg focus:outline-none";
            btn.innerText = "SPÅR: YTTRE (RÖTT) 🔀";
        }
    }
}

export function toggleSwitch() {
    targetTrack = targetTrack === 'inner' ? 'outer' : 'inner';
    updateButtonUI();
}

function spawnBomb() {
    const isOuter = Math.random() > 0.5;
    const track = isOuter ? 'outer' : 'inner';
    
    // Begränsa till nedre bottenmitten (mellan 60 och 120 grader)
    const minAngle = Math.PI / 3;
    const maxAngle = (2 * Math.PI) / 3;
    const angle = minAngle + Math.random() * (maxAngle - minAngle);
    
    bomb = { track, angle };
}

export function startMinigame() {
    isPlaying = true;
    updateButtonUI(); 
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
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // FIX: Räkna om hastigheten så vi förflyttar oss lika många pixlar oavsett var vi är på ellipsen
    const dTheta = velocity / Math.hypot(currentRx * Math.sin(theta), currentRy * Math.cos(theta));
    
    let prevTheta = theta;
    theta += dTheta;
    
    if (theta >= Math.PI * 2) {
        theta -= Math.PI * 2;
        prevTheta -= Math.PI * 2;
    }
    
    // 270 grader = 1.5 * PI (Toppen av skärmen)
    const topAngle = 1.5 * Math.PI;
    if (prevTheta < topAngle && theta >= topAngle) {
        gameScore++;
        velocity += 0.2; // Öka hastigheten i pixlar per frame
        spawnBomb(); 
        
        if(gameScore > highScore) { 
            highScore = gameScore; 
            localStorage.setItem('train_hs', highScore); 
        }
    }

    const targetRx = targetTrack === 'inner' ? pathInner.rx : pathOuter.rx;
    const targetRy = targetTrack === 'inner' ? pathInner.ry : pathOuter.ry;

    // LERP (mjuk övergång) för bytet mellan spåren
    currentRx += (targetRx - currentRx) * 0.15; 
    currentRy += (targetRy - currentRy) * 0.15; 

    // Tågets position
    const trainX = cx + currentRx * Math.cos(theta);
    const trainY = cy + currentRy * Math.sin(theta);
    
    // Bombens position
    const bRx = bomb.track === 'outer' ? pathOuter.rx : pathInner.rx;
    const bRy = bomb.track === 'outer' ? pathOuter.ry : pathInner.ry;
    const bombX = cx + bRx * Math.cos(bomb.angle);
    const bombY = cy + bRy * Math.sin(bomb.angle);

    // Krock!
    if (Math.hypot(trainX - bombX, trainY - bombY) < 25) {
        gameScore = 0;
        velocity = baseVelocity;
        theta = Math.PI / 2;
        currentRx = pathInner.rx;
        currentRy = pathInner.ry;
        targetTrack = 'inner';
        updateButtonUI();
        spawnBomb();
    }

    // --- RITA UT ALLT ---
    ctx.clearRect(0, 0, 800, 300);
    
    // 1. Rita guider för spåren (färgade)
    // 46px tjocklek gör att de lägger sig snyggt inuti 50px-gapet mellan väggarna
    ctx.lineWidth = 46; 
    
    // Inre spår (Blått)
    ctx.strokeStyle = "rgba(59, 130, 246, 0.2)"; 
    ctx.beginPath(); 
    ctx.ellipse(cx, cy, pathInner.rx, pathInner.ry, 0, 0, Math.PI * 2); 
    ctx.stroke();

    // Yttre spår (Rött)
    ctx.strokeStyle = "rgba(239, 68, 68, 0.2)"; 
    ctx.beginPath(); 
    ctx.ellipse(cx, cy, pathOuter.rx, pathOuter.ry, 0, 0, Math.PI * 2); 
    ctx.stroke();

    // 2. Rita de 3 avgränsningsringarna
    ctx.strokeStyle = "#475569"; // Slate 600
    ctx.lineWidth = 4;
    
    ctx.beginPath(); ctx.ellipse(cx, cy, wallInner.rx, wallInner.ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, wallMid.rx, wallMid.ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, wallOuter.rx, wallOuter.ry, 0, 0, Math.PI * 2); ctx.stroke();

    // 3. Rita mittpunkten
    ctx.fillStyle = "#eab308";
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    // 4. Rita Bomben
    ctx.font = "35px Arial"; 
    ctx.textAlign = "center"; 
    ctx.textBaseline = "middle";
    const pulse = 1 + 0.1 * Math.sin(Date.now() / 150);
    ctx.save();
    ctx.translate(bombX, bombY);
    ctx.scale(pulse, pulse);
    ctx.fillText("🧨", 0, 0);
    ctx.restore();

    // 5. Rita Tåget
    // Räkna ut rätt rotation (derivatan av ellipsen)
    const trainRot = Math.atan2(currentRy * Math.cos(theta), -currentRx * Math.sin(theta));
    
    ctx.save();
    ctx.translate(trainX, trainY);
    ctx.rotate(trainRot); 
    ctx.font = "40px Arial";
    ctx.fillText("🚂", 0, 0);
    ctx.restore();
    
    // Uppdatera Poäng i UI
    const sDisplay = document.getElementById('scoreDisplay');
    if(sDisplay) sDisplay.innerText = gameScore;
    const hsDisplay = document.getElementById('hsDisplay');
    if(hsDisplay) hsDisplay.innerText = highScore;

    // Loopa
    gameLoopId = requestAnimationFrame(runGame);
}
