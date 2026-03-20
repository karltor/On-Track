// --- ELLIPTISKT TÅG MINIGAME LOGIK ---
let gameScore = 0;
let highScore = parseInt(localStorage.getItem('train_hs')) || 0;

// Geometri-konstanter
const cx = 400; // Mitten av canvas X
const cy = 150; // Mitten av canvas Y
const a = 50;   // Bas-radie (något mindre nu när vi sträcker ut den)
const scaleX = 2.5; // Gör den 2.5 gånger bredare än vad den är hög (ellips)

// Spårens radier (exakt mellan ringarna)
const rInner = a * 1.25; 
const rOuter = a * 1.75; 

let theta = Math.PI / 2; // Starta rakt ner i mitten
let baseSpeed = 0.01; // Halverad starthastighet
let speed = baseSpeed;

let targetTrack = 'inner';
let currentR = rInner;

let bomb = { r: rOuter, angle: Math.PI / 2 }; 
let gameLoopId = null;
let isPlaying = false;

// Hjälpfunktion för att synka knappen
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
    const r = isOuter ? rOuter : rInner;
    
    // Begränsa till nedre bottenmitten (60 till 120 grader)
    // 60 grader = PI/3, 120 grader = 2*PI/3
    const minAngle = Math.PI / 3;
    const maxAngle = (2 * Math.PI) / 3;
    const angle = minAngle + Math.random() * (maxAngle - minAngle);
    
    bomb = { r, angle };
}

export function startMinigame() {
    isPlaying = true;
    updateButtonUI(); // Sätt rätt text på knappen direkt när spelet startar
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
    
    let prevTheta = theta;
    theta += speed;
    
    if (theta >= Math.PI * 2) {
        theta -= Math.PI * 2;
        prevTheta -= Math.PI * 2;
    }
    
    // 270 grader = 1.5 * PI (Toppen av skärmen)
    const topAngle = 1.5 * Math.PI;
    if (prevTheta < topAngle && theta >= topAngle) {
        gameScore++;
        speed += 0.0008; // Mildare ökning nu när grundhastigheten är lägre
        spawnBomb(); 
        
        if(gameScore > highScore) { 
            highScore = gameScore; 
            localStorage.setItem('train_hs', highScore); 
        }
    }

    currentR += (targetR - currentR) * 0.15; 

    // Ellips-matte: multiplicera X med scaleX
    const trainX = cx + currentR * scaleX * Math.cos(theta);
    const trainY = cy + currentR * Math.sin(theta);
    
    const bombX = cx + bomb.r * scaleX * Math.cos(bomb.angle);
    const bombY = cy + bomb.r * Math.sin(bomb.angle);

    // Krock!
    if (Math.hypot(trainX - bombX, trainY - bombY) < 25) {
        gameScore = 0;
        speed = baseSpeed;
        theta = Math.PI / 2;
        currentR = rInner;
        targetTrack = 'inner';
        updateButtonUI();
        spawnBomb();
    }

    // --- RITA UT ALLT ---
    ctx.clearRect(0, 0, 800, 300);
    
    // 1. Rita guider för spåren (färgade!)
    ctx.lineWidth = 20;
    
    // Inre (Blått)
    ctx.strokeStyle = "rgba(59, 130, 246, 0.2)"; 
    ctx.beginPath(); 
    ctx.ellipse(cx, cy, rInner * scaleX, rInner, 0, 0, Math.PI * 2); 
    ctx.stroke();

    // Yttre (Rött)
    ctx.strokeStyle = "rgba(239, 68, 68, 0.2)"; 
    ctx.beginPath(); 
    ctx.ellipse(cx, cy, rOuter * scaleX, rOuter, 0, 0, Math.PI * 2); 
    ctx.stroke();

    // 2. Rita de 3 solida avgränsningsringarna
    ctx.strokeStyle = "#475569"; // Slate 600
    ctx.lineWidth = 4;
    
    ctx.beginPath(); ctx.ellipse(cx, cy, a * scaleX, a, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, a * 1.5 * scaleX, a * 1.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, a * 2 * scaleX, a * 2, 0, 0, Math.PI * 2); ctx.stroke();

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
    // Räkna ut rätt rotation för en ellips (deriveringen av kurvan)
    const trainRot = Math.atan2(Math.cos(theta), -scaleX * Math.sin(theta));
    
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
