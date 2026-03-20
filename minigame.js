// --- STADIUM TÅG MINIGAME LOGIK ---
let gameScore = 0;
let highScore = parseInt(localStorage.getItem('train_hs')) || 0;

const cx = 400; // Mitten av canvas X
const cy = 150; // Mitten av canvas Y

// Stadium-konstanter
const halfL = 120; // Halva längden på raksträckan (total raksträcka blir 240px)

// Radier för spåren
const rInner = 55;
const rOuter = 105;

let baseVelocity = 3;  // Jämn hastighet i pixlar per frame
let velocity = baseVelocity;
let currentDist = 0;   // Hur långt tåget åkt längs spåret

let targetTrack = 'inner';
let currentR = rInner;

let bomb = { r: rOuter, d: 0 }; 
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
    const r = isOuter ? rOuter : rInner;
    
    // Total spårlängd
    const L = 4 * halfL + 2 * Math.PI * r;
    
    // Vi vill att bomben ska spawna på den nedre halvan.
    // Nedre halvan börjar halvvägs genom vänstra kurvan, 
    // går via bottenrakan, och slutar halvvägs genom högra kurvan.
    const startD = 3 * halfL + 1.5 * Math.PI * r; 
    const rangeD = Math.PI * r + 2 * halfL;
    
    // Slumpa en plats och se till att den loopar runt rätt
    bomb = { 
        r: r, 
        d: (startD + Math.random() * rangeD) % L 
    };
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

// Magisk funktion som räknar ut exakt X, Y och rotation 
// baserat på hur långt man åkt (d) och vilken radie (r) man ligger på.
function getTrackPos(d, r) {
    const L = 4 * halfL + 2 * Math.PI * r;
    d = d % L;
    if (d < 0) d += L;
    
    let x, y, rot;
    
    if (d <= halfL) {
        // Raka botten (högra halvan)
        x = cx + d;
        y = cy + r;
        rot = 0; // Åker höger
    } 
    else if (d <= halfL + Math.PI * r) {
        // Högra kurvan
        let s = d - halfL;
        let theta = 0.5 * Math.PI - s / r; // Går från 90 till -90 grader
        x = cx + halfL + r * Math.cos(theta);
        y = cy + r * Math.sin(theta);
        rot = theta - Math.PI / 2;
    } 
    else if (d <= 3 * halfL + Math.PI * r) {
        // Raka toppen
        let s = d - (halfL + Math.PI * r);
        x = cx + halfL - s;
        y = cy - r;
        rot = Math.PI; // Åker vänster
    } 
    else if (d <= 3 * halfL + 2 * Math.PI * r) {
        // Vänstra kurvan
        let s = d - (3 * halfL + Math.PI * r);
        let theta = 1.5 * Math.PI - s / r; // Går från 270 till 90 grader
        x = cx - halfL + r * Math.cos(theta);
        y = cy + r * Math.sin(theta);
        rot = theta - Math.PI / 2;
    } 
    else {
        // Raka botten (vänstra halvan)
        let s = d - (3 * halfL + 2 * Math.PI * r);
        x = cx - halfL + s;
        y = cy + r;
        rot = 0; // Åker höger
    }
    
    return { x, y, rot };
}

// Hjälpfunktion för att rita stadium-banan
function drawStadium(ctx, r) {
    ctx.beginPath();
    ctx.arc(cx + halfL, cy, r, -Math.PI/2, Math.PI/2); // Höger kurva
    ctx.lineTo(cx - halfL, cy + r);                    // Botten-raka
    ctx.arc(cx - halfL, cy, r, Math.PI/2, -Math.PI/2); // Vänster kurva
    ctx.closePath();                                   // Toppen-raka
    ctx.stroke();
}

function runGame() {
    if (!isPlaying) return;
    
    const canvas = document.getElementById('gameCanvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let prevDist = currentDist;
    currentDist += velocity;
    
    // Mjuk övergång mellan inner och ytter-radie
    const targetR = targetTrack === 'inner' ? rInner : rOuter;
    currentR += (targetR - currentR) * 0.15; 
    
    // Tanka av längden så vi inte får ofantligt stora tal
    const currentL = 4 * halfL + 2 * Math.PI * currentR;
    if (currentDist >= currentL) {
        currentDist -= currentL;
        prevDist -= currentL;
    }
    
    // Mitten av toppen är exakt på avståndet "2*halfL + pi*R"
    const topMid = 2 * halfL + Math.PI * currentR;
    if (prevDist < topMid && currentDist >= topMid) {
        gameScore++;
        velocity += 0.2; // Spelares hastighet ökar i pixlar per frame
        spawnBomb(); 
        
        if(gameScore > highScore) { 
            highScore = gameScore; 
            localStorage.setItem('train_hs', highScore); 
        }
    }

    // Hämta positioner
    const trainPos = getTrackPos(currentDist, currentR);
    const bombPos = getTrackPos(bomb.d, bomb.r);

    // Krock!
    if (Math.hypot(trainPos.x - bombPos.x, trainPos.y - bombPos.y) < 25) {
        gameScore = 0;
        velocity = baseVelocity;
        currentDist = 0; // Återställ tåget till bottenmitten
        currentR = rInner;
        targetTrack = 'inner';
        updateButtonUI();
        spawnBomb();
    }

    // --- RITA UT ALLT ---
    ctx.clearRect(0, 0, 800, 300);
    
    // 1. Rita guider för spåren (Blått och Rött)
    ctx.lineWidth = 46; // Passar exakt inuti de mörka väggarna (50px gap)
    
    ctx.strokeStyle = "rgba(59, 130, 246, 0.2)"; 
    drawStadium(ctx, rInner);
    
    ctx.strokeStyle = "rgba(239, 68, 68, 0.2)"; 
    drawStadium(ctx, rOuter);

    // 2. Rita de 3 solida avgränsningsväggarna
    ctx.strokeStyle = "#475569"; // Slate 600
    ctx.lineWidth = 4;
    drawStadium(ctx, 30);  // Inre
    drawStadium(ctx, 80);  // Mitten
    drawStadium(ctx, 130); // Yttre

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
    ctx.translate(bombPos.x, bombPos.y);
    ctx.scale(pulse, pulse);
    ctx.fillText("🧨", 0, 0);
    ctx.restore();

    // 5. Rita Tåget
    ctx.save();
    ctx.translate(trainPos.x, trainPos.y);
    
    // Tåg-emojin tittar egentligen åt VÄNSTER (180 grader). 
    // Vi vill att den tittar åt `trainPos.rot`.
    ctx.rotate(trainPos.rot - Math.PI); 
    
    // För att förhindra att den hamnar upp och ner när den åker höger, 
    // spegelvänder vi dess Y-axel om den åker i högergående riktning!
    if (Math.cos(trainPos.rot) > 0.01) {
        ctx.scale(1, -1);
    }
    
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
