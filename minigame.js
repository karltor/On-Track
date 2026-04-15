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

// --- SPELINSTÄLLNINGAR ---
let baseVelocity = 4.5;  // Bas-hastighet i pixlar per frame
let curveSpeedMultiplier = 0.75; // Sakta ner tåget med 20% i kurvorna (0.8 = 80% hastighet)
let velocity = baseVelocity;

let currentDist = 0;   // Hur långt tåget åkt längs INNER-spåret (vår referens)
let targetTrack = 'inner';
let currentR = rInner;

let bomb = { track: 'outer', d: 0, active: true }; 
let explosion = { active: false, x: 0, y: 0, timer: 0 };
let hasHitBombThisLap = false; // Håller koll på om vi ska få 0 poäng i slutet av varvet

let gameLoopId = null;
let isPlaying = false;

function updateButtonUI() {
    const btn = document.getElementById('switchBtn');
    if(!btn) return;
    const isInner = targetTrack === 'inner';
    // Byt bara de färgklasser som faktiskt skiljer – undvik att skriva över
    // hela className-strängen (orsakar onödig reflow på svagare Chromebooks).
    btn.classList.toggle('border-blue-700', isInner);
    btn.classList.toggle('bg-blue-500', isInner);
    btn.classList.toggle('hover:bg-blue-400', isInner);
    btn.classList.toggle('border-red-700', !isInner);
    btn.classList.toggle('bg-red-500', !isInner);
    btn.classList.toggle('hover:bg-red-400', !isInner);
    const label = isInner ? "SPÅR: INRE (BLÅTT) 🔄" : "SPÅR: YTTRE (RÖTT) 🔀";
    if (btn.textContent !== label) btn.textContent = label;
}

export function toggleSwitch() {
    targetTrack = targetTrack === 'inner' ? 'outer' : 'inner';
    updateButtonUI();
}

function spawnBomb() {
    const isOuter = Math.random() > 0.5;
    const track = isOuter ? 'outer' : 'inner';
    
    // Total spårlängd för inre spåret
    const L = 4 * halfL + 2 * Math.PI * rInner;
    
    // Nedre halvan: från mitten av vänster kurva till mitten av höger kurva
    const startD = 3 * halfL + 1.5 * Math.PI * rInner; 
    const rangeD = Math.PI * rInner + 2 * halfL;
    
    bomb = { 
        track: track, 
        d: (startD + Math.random() * rangeD) % L,
        active: true
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

// Funktion för att beräkna position, rotation och NORMAL-vektor på inre spåret
function getRefPosAndNormal(d) {
    const L = 4 * halfL + 2 * Math.PI * rInner;
    d = d % L;
    if (d < 0) d += L;
    
    let x, y, rot, nx, ny, isCurve;
    
    if (d <= halfL) {
        // Raka botten (högra halvan)
        x = cx + d; y = cy + rInner;
        nx = 0; ny = 1; rot = 0; isCurve = false;
    } 
    else if (d <= halfL + Math.PI * rInner) {
        // Högra kurvan
        let s = d - halfL;
        let theta = 0.5 * Math.PI - s / rInner; // Går från 90 till -90 grader
        x = cx + halfL + rInner * Math.cos(theta); y = cy + rInner * Math.sin(theta);
        nx = Math.cos(theta); ny = Math.sin(theta); rot = theta - Math.PI / 2; isCurve = true;
    } 
    else if (d <= 3 * halfL + Math.PI * rInner) {
        // Raka toppen
        let s = d - (halfL + Math.PI * rInner);
        x = cx + halfL - s; y = cy - rInner;
        nx = 0; ny = -1; rot = Math.PI; isCurve = false;
    } 
    else if (d <= 3 * halfL + 2 * Math.PI * rInner) {
        // Vänstra kurvan
        let s = d - (3 * halfL + Math.PI * rInner);
        let theta = -0.5 * Math.PI - s / rInner; // Går från 270 till 90 grader
        x = cx - halfL + rInner * Math.cos(theta); y = cy + rInner * Math.sin(theta);
        nx = Math.cos(theta); ny = Math.sin(theta); rot = theta - Math.PI / 2; isCurve = true;
    } 
    else {
        // Raka botten (vänstra halvan)
        let s = d - (3 * halfL + 2 * Math.PI * rInner);
        x = cx - halfL + s; y = cy + rInner;
        nx = 0; ny = 1; rot = 0; isCurve = false;
    }
    
    return { x, y, nx, ny, rot, isCurve };
}

// Hjälpfunktion för att rita stadium-banan
function drawStadium(ctx, r) {
    ctx.beginPath();
    ctx.arc(cx + halfL, cy, r, -Math.PI/2, Math.PI/2); 
    ctx.lineTo(cx - halfL, cy + r);                    
    ctx.arc(cx - halfL, cy, r, Math.PI/2, -Math.PI/2); 
    ctx.closePath();                                   
    ctx.stroke();
}

function runGame() {
    if (!isPlaying) return;
    
    const canvas = document.getElementById('gameCanvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Kontrollera om vi är i en kurva just nu för att applicera fartminskning
    const currentRef = getRefPosAndNormal(currentDist);
    let currentVel = velocity * (currentRef.isCurve ? curveSpeedMultiplier : 1.0);

    // FIX: Justera d-värdet så att hastigheten (pixlar) förblir konstant 
    // även om vi befinner oss på det längre yttre spåret.
    let delta_d = currentRef.isCurve ? currentVel * (rInner / currentR) : currentVel;
    
    let prevDist = currentDist;
    currentDist += delta_d;
    
    // Mjuk övergång mellan inner och ytter-radie
    const targetR = targetTrack === 'inner' ? rInner : rOuter;
    currentR += (targetR - currentR) * 0.15; 
    
    // Tanka av längden
    const L = 4 * halfL + 2 * Math.PI * rInner;
    if (currentDist >= L) {
        currentDist -= L;
        prevDist -= L;
    }
    
    // Nytt varv! (Mitten av toppen)
    const topMid = 2 * halfL + Math.PI * rInner;
    if (prevDist < topMid && currentDist >= topMid) {
        if (hasHitBombThisLap) {
            // Straff för att ha sprängt bomben: 0 poäng och farten återställs
            gameScore = 0;
            velocity = baseVelocity;
            hasHitBombThisLap = false; 
        } else {
            // Lyckat varv!
            gameScore++;
            velocity += 0.25; 
            if(gameScore > highScore) { 
                highScore = gameScore; 
                localStorage.setItem('train_hs', highScore); 
            }
        }
        spawnBomb(); 
    }

    // ------------------------------------------------------------------
    // Räkna ut Tågets och Bombens exakta X/Y genom Normal-projicering
    // ------------------------------------------------------------------
    const refTrain = getRefPosAndNormal(currentDist);
    const offsetTrain = currentR - rInner;
    const trainX = refTrain.x + offsetTrain * refTrain.nx;
    const trainY = refTrain.y + offsetTrain * refTrain.ny;

    const refBomb = getRefPosAndNormal(bomb.d);
    const offsetBomb = (bomb.track === 'outer' ? rOuter : rInner) - rInner;
    const bombX = refBomb.x + offsetBomb * refBomb.nx;
    const bombY = refBomb.y + offsetBomb * refBomb.ny;

    // Krock! (Gäller bara om bomben inte redan sprängts)
    if (bomb.active && Math.hypot(trainX - bombX, trainY - bombY) < 25) {
        bomb.active = false;
        hasHitBombThisLap = true;
        gameScore = 0;
        
        // Starta explosionseffekt
        explosion = { active: true, x: bombX, y: bombY, timer: 30 };
    }

    // --- RITA UT ALLT ---
    ctx.clearRect(0, 0, 800, 300);
    
    ctx.lineWidth = 46; 
    
    ctx.strokeStyle = "rgba(59, 130, 246, 0.2)"; 
    drawStadium(ctx, rInner);
    
    ctx.strokeStyle = "rgba(239, 68, 68, 0.2)"; 
    drawStadium(ctx, rOuter);

    ctx.strokeStyle = "#475569"; 
    ctx.lineWidth = 4;
    drawStadium(ctx, 30);  
    drawStadium(ctx, 80);  
    drawStadium(ctx, 130); 

    ctx.fillStyle = "#eab308";
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    // Rita Bomben (bara om den är aktiv)
    if (bomb.active) {
        ctx.font = "35px Arial"; 
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle";
        const pulse = 1 + 0.1 * Math.sin(Date.now() / 150);
        ctx.save();
        ctx.translate(bombX, bombY);
        ctx.scale(pulse, pulse);
        ctx.fillText("🧨", 0, 0);
        ctx.restore();
    }

    // Rita Explosion (vid krock)
    if (explosion.active) {
        ctx.save();
        ctx.globalAlpha = explosion.timer / 30; // Tonar ut
        ctx.font = "50px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("💥", explosion.x, explosion.y);
        ctx.restore();
        
        explosion.timer--;
        if (explosion.timer <= 0) explosion.active = false;
    }

    // Rita Tåget
    ctx.save();
    ctx.translate(trainX, trainY);
    ctx.rotate(refTrain.rot - Math.PI); 
    
    if (Math.cos(refTrain.rot) > 0.01) {
        ctx.scale(1, -1);
    }
    
    // Gör tåget genomskinligt (blinkande) om vi sprängt bomben och väntar på nästa varv
    if (hasHitBombThisLap) {
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(Date.now() / 50);
    }
    
    ctx.font = "40px Arial";
    ctx.fillText("🚂", 0, 0);
    ctx.restore();
    
    // Uppdatera Poäng i UI
    const sDisplay = document.getElementById('scoreDisplay');
    if(sDisplay) sDisplay.innerText = gameScore;
    const hsDisplay = document.getElementById('hsDisplay');
    if(hsDisplay) hsDisplay.innerText = highScore;

    gameLoopId = requestAnimationFrame(runGame);
}
