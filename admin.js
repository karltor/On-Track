import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCZGQi85oGYum0mnUowUcw4QMt3tyoHK1U",
    authDomain: "on-track-d77d0.firebaseapp.com",
    projectId: "on-track-d77d0",
    storageBucket: "on-track-d77d0.firebasestorage.app",
    messagingSenderId: "515234485983",
    appId: "1:515234485983:web:daa02d8bbc09e30a65fb6a",
    measurementId: "G-W1CNJ79WPW"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const authReady = new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
    setTimeout(() => reject(new Error("Auth timeout")), 10000);
});

signInAnonymously(auth).catch(err => {
    console.error("Anonymous auth failed:", err);
    window.showToast(`Auth-fel: ${err.code || err.message}`, "❌");
});

// App State
const STORAGE_KEY = 'pa_sparet_saved_boards';
const DEFAULTS_KEY = 'pa_sparet_imported_defaults';
export let boards = [];
let selectedIndex = null;
let editData = null; 
let boardToExport = null;

// GLOBAL TOAST FUNKTION
window.showToast = (msg, icon = "✨") => {
    const t = document.getElementById('toast');
    document.getElementById('toastMsg').innerText = msg;
    document.getElementById('toastIcon').innerText = icon;
    t.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => t.classList.add('translate-y-24', 'opacity-0'), 3500);
};

// Ladda data från LocalStorage
function loadBoards() {
    try { boards = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } 
    catch { boards = []; }
    renderSidebar();
}

export function saveBoards() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
    renderSidebar();
}

// Auto-importera standardpaket
async function loadDefaultPackages() {
    let imported = JSON.parse(localStorage.getItem(DEFAULTS_KEY)) || [];
    const filesToCheck = ['paket1.json', 'paket2.json']; 
    let newlyImported = false;

    for (const file of filesToCheck) {
        if (!imported.includes(file)) {
            try {
                const response = await fetch(file);
                if (response.ok) {
                    const data = await response.json();
                    const packages = Array.isArray(data) ? data : [data];
                    
                    packages.forEach(pkg => {
                        if (pkg.title && pkg.boards) {
                            boards.push(pkg);
                            newlyImported = true;
                        }
                    });
                    imported.push(file); 
                }
            } catch (e) {
                // Tyst ignorering om filen inte finns
            }
        }
    }

    if (newlyImported) {
        saveBoards(); 
        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(imported));
    }
}

// Kolla om URL har en delningslänk
async function checkSharedLink() {
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('share');
    
    if (shareId) {
        window.showToast("Hämtar delat spelbräde...", "⏳");
        try {
            await authReady;
            const docRef = doc(db, "shared_boards", shareId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const sharedBoard = docSnap.data();
                boards.push(sharedBoard);
                saveBoards();
                
                window.showToast(`Spelbrädet "${sharedBoard.title}" har lagts till!`, "🎉");
                window.setView('view', boards.length - 1);
            } else {
                window.showToast("Delningslänken är ogiltig eller har gått ut.", "❌");
            }
        } catch(e) {
            window.showToast("Nätverksfel vid hämtning av paket.", "❌");
        } finally {
            const newUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }
}

// ----------------------------------------------------
// UI RENDERING
// ----------------------------------------------------

export function setView(view, index = null) {
    const mainEl = document.getElementById('mainContent');
    selectedIndex = index;
    renderSidebar(); 
    
    if (view === 'welcome') {
        mainEl.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                <div class="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                    <svg class="w-12 h-12 text-slate-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line></svg>
                </div>
                <h2 class="text-2xl font-bold text-slate-700 mb-2">Välkommen till På Rätt Spår</h2>
                <p>Välj ett paket till vänster eller skapa ett nytt.</p>
            </div>
        `;
    } 
    else if (view === 'import') {
        mainEl.innerHTML = `
            <div class="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200">
                <h2 class="text-3xl font-black text-slate-800 mb-2">Klistra in JSON</h2>
                <p class="text-slate-500 mb-6">Om du har fått råkod från ett spelbräde kan du klistra in det här.</p>
                <textarea id="jsonInput" class="w-full h-64 bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent mb-4" placeholder='{"title": "...", "boards": [...]}'></textarea>
                <div class="flex items-center justify-end">
                    <button onclick="handleImport()" class="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-lg shadow-sm transition">Spara paket</button>
                </div>
            </div>
        `;
    }
    else if (view === 'view' && index !== null) {
        const b = boards[index];
        let questionsHtml = b.boards.map((q, i) => `
            <div class="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h4 class="text-xs font-bold text-slate-400 uppercase mb-4 tracking-wider">Fråga ${i+1}</h4>
                <div class="space-y-3 mb-6">
                    <div class="flex gap-4"><span class="font-bold text-amber-500 w-8">10p</span> <span class="text-slate-700">${q.clues[0]}</span></div>
                    <div class="flex gap-4"><span class="font-bold text-amber-500 w-8">8p</span> <span class="text-slate-700">${q.clues[1]}</span></div>
                    <div class="flex gap-4"><span class="font-bold text-amber-500 w-8">6p</span> <span class="text-slate-700">${q.clues[2]}</span></div>
                    <div class="flex gap-4"><span class="font-bold text-amber-500 w-8">4p</span> <span class="text-slate-700">${q.clues[3]}</span></div>
                    <div class="flex gap-4"><span class="font-bold text-amber-500 w-8">2p</span> <span class="text-slate-700">${q.clues[4]}</span></div>
                </div>
                <div class="bg-emerald-50 text-emerald-800 p-4 rounded-lg border border-emerald-100 flex items-center justify-between">
                    <span class="text-sm font-semibold uppercase tracking-wider text-emerald-600">Svar</span>
                    <span class="font-black text-xl">${q.answer}</span>
                </div>
            </div>
        `).join('');

        mainEl.innerHTML = `
            <div class="max-w-4xl mx-auto pb-20">
                <div class="flex justify-between items-end mb-8">
                    <div>
                        <h2 class="text-4xl font-black text-slate-800 mb-2">${b.title}</h2>
                        <p class="text-slate-500 font-medium">${b.boards.length} frågor i detta paket</p>
                    </div>
                    <div class="flex gap-3">
                        <button onclick="deleteBoard(${index})" class="px-4 py-2 bg-white border border-slate-200 text-red-600 hover:bg-red-50 rounded-lg font-semibold transition shadow-sm flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                            Radera
                        </button>
                        <button onclick="openExportModal(${index})" class="px-4 py-2 bg-white border border-slate-200 text-blue-600 hover:bg-slate-50 rounded-lg font-semibold transition shadow-sm flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" x2="12" y1="2" y2="15"></line></svg>
                            Dela
                        </button>
                        <button onclick="editBoard(${index})" class="px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg font-semibold transition shadow-sm">Redigera</button>
                        <button onclick="startSession(${index})" class="px-6 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg font-black transition shadow-sm flex items-center gap-2 text-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            Starta Spel
                        </button>
                    </div>
                </div>
                <div class="space-y-6">
                    ${questionsHtml}
                </div>
                <div class="mt-12 text-center text-slate-300">———</div>
            </div>
        `;
    }
    else if (view === 'edit') {
        renderEditForm();
    }
}
window.setView = setView;

function renderSidebar() {
    const listEl = document.getElementById('boardsList');
    listEl.innerHTML = '';
    
    boards.forEach((board, index) => {
        const isActive = index === selectedIndex;
        const activeClass = isActive ? 'bg-amber-50 border-amber-200 shadow-sm' : 'bg-transparent border-transparent hover:bg-slate-100';
        
        const item = document.createElement('div');
        item.className = `w-full text-left py-2 px-3 rounded-lg border transition-all cursor-pointer flex justify-between items-center ${activeClass}`;
        item.onclick = () => window.setView('view', index);
        item.innerHTML = `
            <h3 class="font-bold text-sm ${isActive ? 'text-amber-900' : 'text-slate-700'} leading-tight pr-2">${board.title}</h3>
            <span class="text-[10px] font-bold ${isActive ? 'text-amber-600' : 'text-slate-400'}">${board.boards.length}</span>
        `;
        listEl.appendChild(item);
    });
}

// ----------------------------------------------------
// EXPORT MODAL & DELNING
// ----------------------------------------------------
window.openExportModal = (index) => {
    boardToExport = boards[index];
    const modal = document.getElementById('exportModal');
    const content = document.getElementById('exportModalContent');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
    }, 10);
};

window.closeExportModal = () => {
    const modal = document.getElementById('exportModal');
    const content = document.getElementById('exportModalContent');
    
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        boardToExport = null;
    }, 200);
};

window.copyJson = () => {
    if(!boardToExport) return;
    navigator.clipboard.writeText(JSON.stringify(boardToExport, null, 2));
    window.showToast("Rå JSON-kod kopierad!", "📋");
    window.closeExportModal();
};

window.copyShareLink = async () => {
    if(!boardToExport) return;
    const btn = document.getElementById('btnShareLink');
    const originalText = btn.innerHTML;
    btn.innerHTML = "Skapar länk...";

    try {
        await authReady;
        const shareId = Math.random().toString(36).substring(2, 10);
        await setDoc(doc(db, "shared_boards", shareId), boardToExport);
        
        const basePath = window.location.pathname;
        const link = `${window.location.origin}${basePath}?share=${shareId}`;
        
        navigator.clipboard.writeText(link);
        window.showToast("Länken kopierades till urklipp!", "🔗");
        window.closeExportModal();
    } catch (e) {
        console.error(e);
        window.showToast("Kunde inte spara brädet till molnet.", "❌");
    } finally {
        btn.innerHTML = originalText;
    }
};

// ----------------------------------------------------
// REDIGERA / SKAPA LOGIK
// ----------------------------------------------------

window.createNewBoard = () => {
    editData = { title: "Nytt Spelbräde", boards: [{ answer: "", clues: ["","","","",""] }] };
    window.setView('edit');
};

window.editBoard = (index) => {
    editData = JSON.parse(JSON.stringify(boards[index]));
    editData.editIndex = index; 
    window.setView('edit');
};

function renderEditForm() {
    const mainEl = document.getElementById('mainContent');
    
    let questionsHtml = editData.boards.map((q, qIndex) => `
        <div class="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative">
            <div class="flex justify-between items-center mb-4">
                <h4 class="text-sm font-bold text-slate-800">Fråga ${qIndex + 1}</h4>
                <button onclick="removeQuestion(${qIndex})" class="text-red-500 hover:text-red-700 text-sm font-semibold">Ta bort</button>
            </div>
            
            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Rätt Svar</label>
            <input type="text" value="${q.answer}" onchange="updateData(${qIndex}, 'answer', this.value)" class="w-full bg-slate-50 border border-slate-200 rounded-md p-3 mb-6 font-bold text-lg focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="T.ex. Paris">
            
            <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Ledtrådar</label>
            <div class="space-y-2">
                <div class="flex items-center gap-3"><span class="font-bold text-amber-500 w-6 text-right">10p</span> <input type="text" value="${q.clues[0]}" onchange="updateData(${qIndex}, 'clue', this.value, 0)" class="flex-1 bg-slate-50 border border-slate-200 rounded-md p-2 focus:outline-none focus:border-amber-500" placeholder="Svåraste ledtråden..."></div>
                <div class="flex items-center gap-3"><span class="font-bold text-amber-500 w-6 text-right">8p</span> <input type="text" value="${q.clues[1]}" onchange="updateData(${qIndex}, 'clue', this.value, 1)" class="flex-1 bg-slate-50 border border-slate-200 rounded-md p-2 focus:outline-none focus:border-amber-500" placeholder="Nästa ledtråd..."></div>
                <div class="flex items-center gap-3"><span class="font-bold text-amber-500 w-6 text-right">6p</span> <input type="text" value="${q.clues[2]}" onchange="updateData(${qIndex}, 'clue', this.value, 2)" class="flex-1 bg-slate-50 border border-slate-200 rounded-md p-2 focus:outline-none focus:border-amber-500" placeholder="..."></div>
                <div class="flex items-center gap-3"><span class="font-bold text-amber-500 w-6 text-right">4p</span> <input type="text" value="${q.clues[3]}" onchange="updateData(${qIndex}, 'clue', this.value, 3)" class="flex-1 bg-slate-50 border border-slate-200 rounded-md p-2 focus:outline-none focus:border-amber-500" placeholder="..."></div>
                <div class="flex items-center gap-3"><span class="font-bold text-amber-500 w-6 text-right">2p</span> <input type="text" value="${q.clues[4]}" onchange="updateData(${qIndex}, 'clue', this.value, 4)" class="flex-1 bg-slate-50 border border-slate-200 rounded-md p-2 focus:outline-none focus:border-amber-500" placeholder="Lättaste ledtråden..."></div>
            </div>
        </div>
    `).join('');

    mainEl.innerHTML = `
        <div class="max-w-3xl mx-auto pb-20">
            <div class="flex justify-between items-center mb-8 sticky top-0 bg-slate-50/90 backdrop-blur py-4 z-10 border-b border-slate-200">
                <div class="flex-1 mr-8">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Paketets Namn</label>
                    <input type="text" id="editTitle" value="${editData.title}" onkeyup="editData.title = this.value" onchange="editData.title = this.value" class="w-full bg-transparent text-3xl font-black text-slate-800 placeholder-slate-300 focus:outline-none" placeholder="Namn på spelbrädet...">
                </div>
                <div class="flex gap-2">
                    <button onclick="cancelEdit()" class="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-md font-semibold transition">Avbryt</button>
                    <button onclick="saveEdit()" class="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-bold transition shadow-sm">Spara Ändringar</button>
                </div>
            </div>
            
            <div class="space-y-6">
                ${questionsHtml}
            </div>
            
            <button onclick="addQuestion()" class="mt-6 w-full py-4 border-2 border-dashed border-slate-300 text-slate-500 hover:border-amber-500 hover:text-amber-600 font-bold rounded-xl transition flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="5" y2="19"></line><line x1="5" x2="19" y1="12" y2="12"></line></svg>
                Lägg till en till fråga
            </button>
        </div>
    `;
}

window.updateData = (qIndex, field, value, clueIndex) => {
    if (field === 'answer') {
        editData.boards[qIndex].answer = value;
    } else if (field === 'clue') {
        editData.boards[qIndex].clues[clueIndex] = value;
    }
};

window.addQuestion = () => {
    editData.boards.push({ answer: "", clues: ["","","","",""] });
    renderEditForm();
};

window.removeQuestion = (index) => {
    if(confirm("Är du säker på att du vill ta bort frågan?")) {
        editData.boards.splice(index, 1);
        renderEditForm();
    }
};

window.cancelEdit = () => {
    if (editData.editIndex !== undefined) {
        window.setView('view', editData.editIndex);
    } else {
        window.setView('welcome');
    }
};

window.saveEdit = () => {
    editData.title = document.getElementById('editTitle').value || "Namnlöst Spel";
    
    if (editData.editIndex !== undefined) {
        let i = editData.editIndex;
        delete editData.editIndex;
        boards[i] = editData;
        saveBoards();
        window.setView('view', i);
        window.showToast("Ändringar sparade!");
    } else {
        boards.push(editData);
        saveBoards();
        window.setView('view', boards.length - 1);
        window.showToast("Nytt spelbräde skapat!");
    }
};

window.handleImport = () => {
    const input = document.getElementById('jsonInput').value;
    try {
        const parsed = JSON.parse(input);
        if(!parsed.title || !parsed.boards) throw new Error("JSON saknar 'title' eller 'boards'.");
        
        boards.push(parsed);
        saveBoards();
        
        window.showToast("Paket importerades via JSON!");
        window.setView('view', boards.length - 1);
    } catch (e) {
        window.showToast("Ogiltig JSON.", "❌");
    }
};

window.deleteBoard = (index) => {
    if(confirm("Vill du verkligen radera hela paketet från din enhet?")) {
        boards.splice(index, 1);
        saveBoards();
        window.setView('welcome');
        window.showToast("Paketet raderades.", "🗑️");
    }
};

// STARTA SESSION
window.startSession = async (index) => {
    const selectedBoard = boards[index];
    const pin = Math.floor(1000 + Math.random() * 9000).toString();

    const publicBoards = selectedBoard.boards.map(b => ({ clues: b.clues }));
    const secretAnswers = selectedBoard.boards.map(b => b.answer);

    try {
        await authReady;

        const sessionData = {
            creatorUid: auth.currentUser.uid,
            gameState: "lobby",
            boards: publicBoards,
            currentBoardIndex: 0,
            currentClueIndex: 0,
            teams: [],
            createdAt: new Date().toISOString()
        };

        const batch = writeBatch(db);
        batch.set(doc(db, "sessions", pin), sessionData);
        batch.set(doc(db, "sessions", pin, "private", "answers"), { answers: secretAnswers });
        await batch.commit();

        localStorage.setItem(`pa_sparet_admin_${pin}`, 'true');
        window.location.href = `host.html?session=${pin}`;
    } catch (error) {
        console.error("startSession error:", error);
        window.showToast(`Fel: ${error.code || error.message}`, "❌");
    }
};

// Kör igång allting vid start
loadBoards();
loadDefaultPackages(); 
checkSharedLink();
window.setView('welcome');
