// --- CIRKEL TÅG MINIGAME LOGIK ---
let gameScore = 0;
let highScore = parseInt(localStorage.getItem('train_hs')) || 0;

// Geometri-konstanter
const cx = 400; // Mitten av canvas X
const cy = 150; // Mitten av canvas Y
const a = 60;   // Bas-radie

// Spårens radier (exakt mellan ringarna)
const rInner = a * 1.25; // 75
const rOuter = a * 1.75; // 105

let theta = Math.PI / 2; // Starta rakt ner så vi inte dör direkt
let baseSpeed = 0.02;
let speed = baseSpeed;

let targetTrack = 'inner';
let currentR = rInner;

let bomb = { r: rOuter, angle: Math.PI / 2 }; 
let gameLoopId = null;
let isPlaying = false;

export function toggleSwitch() {
    targetTrack = targetTrack === 'inner' ? 'outer' : 'inner';
    const btn = document.getElementById('switchBtn');
    if(btn) {
        // Uppdaterar knappens utseende beroende på spår
        btn.className = `w-full py-4 border-b-4 rounded-2xl font-black text-2xl active:scale-[0.98] transition-all shadow-lg focus:outline-none ${targetTrack === 'inner' ? 'bg-blue-500 border-blue-700 hover:bg-blue-400 text-white' : 'bg-red-500 border-red-700 hover:bg-red-400 text-white'}`;
        btn.innerText = targetTrack === 'inner' ? "SPÅR: INRE 🔄" : "SPÅR: YTTRE 🔀";
    }
}

function spawnBomb() {
    // Välj spår slumpmässigt
    const isOuter = Math.random() > 0.5;
    const r = isOuter ? rOuter : rInner;
    
    // Canvas Y ökar nedåt, så vinklar mellan 0 och PI är den nedre halvan!
    const angle = Math.random() * Math.PI;
    
    bomb = { r, angle };
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
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let prevTheta = theta;
    theta += speed;
    
    // Håll vinkeln mellan 0 och 2*PI
    if (theta >= Math.PI * 2) {
        theta -= Math.PI * 2;
        prevTheta -= Math.PI * 2;
    }
    
    // Kolla om vi precis passerade toppen (vilket är 270 grader, eller 1.5 * PI)
    const topAngle = 1.5 * Math.PI;
    if (prevTheta < topAngle && theta >= topAngle) {
        gameScore++;
        speed += 0.0015; // Öka farten liiite grann varje varv
        spawnBomb(); // Kasta in en ny bomb på nedre halvan!
        
        if(gameScore > highScore) { 
            highScore = gameScore; 
            localStorage.setItem('train_hs', highScore); 
        }
    }

    // LERP (Linear Interpolation) gör så tåget byter spår snyggt och mjukt
    const targetR = targetTrack === 'inner' ? rInner : rOuter;
    currentR += (targetR - currentR) * 0.15; 

    // Konvertera polära koordinater (radie & vinkel) till X och Y
    const trainX = cx + currentR * Math.cos(theta);
    const trainY = cy + currentR * Math.sin(theta);
    
    const bombX = cx + bomb.r * Math.cos(bomb.angle);
    const bombY = cy + bomb.r * Math.sin(bomb.angle);

    // Krock-detektering (räknar ut avståndet mellan tåg och bomb)
    if (Math.hypot(trainX - bombX, trainY - bombY) < 25) {
        gameScore = 0;
        speed = baseSpeed;
        theta = Math.PI / 2; // Återställ tåget till botten
        currentR = rInner;
        targetTrack = 'inner';
        spawnBomb();
        
        // Återställ knappens UI om vi dog på yttre spåret
        const btn = document.getElementById('switchBtn');
        if(btn) {
            btn.className = "w-full py-4 border-b-4 border-blue-700 bg-blue-500 hover:bg-blue-400 text-white rounded-2xl font-black text-2xl active:scale-[0.98] transition-all shadow-lg focus:outline-none";
            btn.innerText = "SPÅR: INRE 🔄";
        }
    }

    // --- RITA UT ALLT ---
    ctx.clearRect(0, 0, 800, 300);
    
    // 1. Rita de 3 ringarna (a, 1.5a, 2a)
    ctx.strokeStyle = "#475569"; // Slate 600
    ctx.lineWidth = 6;
    
    ctx.beginPath();
    ctx.arc(cx, cy, a, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(cx, cy, a * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(cx, cy, a * 2, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Rita ut en subtil bakgrund för spåren tåget faktiskt åker på
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 20;
    ctx.beginPath(); ctx.arc(cx, cy, rInner, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rOuter, 0, Math.PI * 2); ctx.stroke();

    // 3. Rita mittpunkten
    ctx.fillStyle = "#eab308";
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    // 4. Rita Bomben (med en liten puls-effekt för att göra den läskigare)
    ctx.font = "35px Arial"; 
    ctx.textAlign = "center"; 
    ctx.textBaseline = "middle";
    const pulse = 1 + 0.1 * Math.sin(Date.now() / 100); // Andas in/ut
    ctx.save();
    ctx.translate(bombX, bombY);
    ctx.scale(pulse, pulse);
    ctx.fillText("🧨", 0, 0);
    ctx.restore();

    // 5. Rita Tåget (roterat så det pekar framåt på spåret)
    ctx.save();
    ctx.translate(trainX, trainY);
    ctx.rotate(theta + Math.PI / 2); // Tangentens vinkel är theta + 90 grader
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
