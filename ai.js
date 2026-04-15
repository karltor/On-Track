import { db, auth, authReady, boards, saveBoards, setView, getEditData, setEditData, renderEditForm } from './admin.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { jsonrepair } from 'https://esm.sh/jsonrepair'; 

let geminiApiKey = null;

// Draft State
window.aiDrafts = []; 
window.activeDraftIndex = 0;
window.originalBoardBackup = null;
window.isAiEditMode = false;
window.tempCurrentIndex = -1; 
window.currentAiGenId = null; 
window.aiAbortController = null;

// ==========================================
// 1. AUTENTISERING
// ==========================================
async function ensureAiAuth() {
    if (geminiApiKey) return geminiApiKey;

    await authReady;

    let user = auth.currentUser;
    let needsPopup = true;

    if (user && !user.isAnonymous && user.email) {
        needsPopup = false;
        try {
            await user.getIdToken(true);
        } catch (e) {
            console.warn("Kunde inte uppdatera token, tvingar ny inloggning.");
            needsPopup = true;
        }
    }
    
    try {
        if (needsPopup) {
            window.showToast("Väntar på inloggning...", "⏳");
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ hd: 'nyamunken.se' }); 
            const result = await signInWithPopup(auth, provider);
            user = result.user;
        }
        
        const email = user.email.toLowerCase(); 
        const emailPrefix = email.split('@')[0];
        const isNyamunken = email.endsWith('@nyamunken.se');
        const hasThreeDigits = /\d{3}/.test(emailPrefix); 

        if (isNyamunken && !hasThreeDigits) {
            try {
                const keyDoc = await getDoc(doc(db, "secrets", "gemini"));
                if (keyDoc.exists() && keyDoc.data().key) {
                    geminiApiKey = keyDoc.data().key;
                    if (needsPopup) window.showToast("Inloggad som lärare!", "✅");
                    return geminiApiKey;
                } else {
                    window.showToast("Hittade ingen API-nyckel i databasen.", "❌");
                    return null;
                }
            } catch (firestoreError) {
                console.error("Fel vid hämtning av nyckel:", firestoreError);
                window.showToast("Åtkomst nekad av databasen. Försök igen.", "❌");
                
                if (!needsPopup) {
                    await auth.signOut();
                    signInAnonymously(auth);
                }
                return null;
            }
        } else {
            await auth.signOut();
            signInAnonymously(auth); 
            alert(`Åtkomst nekad för kontot: ${email}.\nEndast lärarkonton från nyamunken.se har tillgång till AI-generering.`);
            return null;
        }
    } catch (error) {
        console.error("Inloggningsfel:", error);
        if(error.code !== 'auth/popup-closed-by-user') {
            window.showToast("Inloggningen misslyckades.", "❌");
        }
        return null;
    }
}

// ==========================================
// 2. SKAPA NYTT BRÄDE MED AI
// ==========================================
window.openAiModal = async () => {
    if (await ensureAiAuth()) {
        const modal = document.getElementById('aiModal');
        const content = document.getElementById('aiModalContent');
        document.getElementById('aiPrompt').value = '';
        document.getElementById('aiLoading').classList.add('hidden');
        document.getElementById('aiButtons').classList.remove('hidden');
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            content.classList.remove('scale-95');
            document.getElementById('aiPrompt').focus();
        }, 10);
    }
};

window.closeAiModal = () => {
    const modal = document.getElementById('aiModal');
    const content = document.getElementById('aiModalContent');
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 200);
};

window.generateAiBoard = async () => {
    const promptText = document.getElementById('aiPrompt').value.trim();
    if (!promptText) return window.showToast("Skriv in ett tema först!", "⚠️");

    document.getElementById('aiButtons').classList.add('hidden');
    document.getElementById('aiLoading').classList.remove('hidden');
    document.getElementById('aiLoading').classList.add('flex');

    try {
        const apiKey = await ensureAiAuth();
        const systemPrompt = `Du är en expert på att skapa engagerande och språkligt rika frågesporter för skolelever, exakt i samma anda som TV-programmet 'På Spåret'.

Krav:
1. Skapa exakt 5 stycken frågor ("boards").
2. Varje fråga ska ha 1 tydligt svar (stad, person, land, händelse, vetenskapligt begrepp etc).
3. Varje fråga måste ha exakt 5 ledtrådar i fallande svårighetsgrad (10p, 8p, 6p, 4p, 2p).
4. Språket, längden och strukturen på ledtrådarna MÅSTE följa denna exakta mall:
   - 10p: Mycket extravagant, akademiskt, snirkligt och rikt språk. Kryptiskt men faktamässigt korrekt. Använd avancerade synonymer. Ska gärna börja med "Vi söker...". (Minst 20-30 ord).
   - 8p: Fortfarande avancerat, ofta med historisk kontext, specifika namn, årtal eller djupare detaljer. (Ca 15-25 ord).
   - 6p: Medelsvårt. Kopplar till välkända exempel, bredare fakta eller kända anekdoter. (Ca 15-20 ord).
   - 4p: Standarddefinitionen, som hämtad ur en skolbok. Tydligt och rakt på sak. (Ca 10-15 ord).
   - 2p: Mycket lätt och direkt. Ge nästan bort svaret helt, t.ex. genom första bokstaven, en extremt känd egenskap eller förkortning. (Ca 8-12 ord).

5. Returnera ENDAST giltig JSON i exakt detta format (inga markdown-taggar, ingen extra text):
{
  "title": "Paketets namn",
  "boards": [
    {
      "answer": "Svaret",
      "clues": ["10p: [Ledtråd]", "8p: [Ledtråd]", "6p: [Ledtråd]", "4p: [Ledtråd]", "2p: [Ledtråd]"]
    }
  ]
}`;
        const userText = `Skapa ett quizpaket om ämnet: "${promptText}".`;
        
        await runMultiModelGeneration(apiKey, systemPrompt, userText, false);
        
        window.closeAiModal();
        document.getElementById('aiPrompt').value = '';
    } catch (e) {
        window.showToast(e.message || "Något gick fel med AI-anropet.", "❌");
    } finally {
        document.getElementById('aiLoading').classList.add('hidden');
        document.getElementById('aiLoading').classList.remove('flex');
        document.getElementById('aiButtons').classList.remove('hidden');
    }
};

// ==========================================
// 3. REDIGERA BEFINTLIGT BRÄDE MED AI
// ==========================================
window.openAiEditModal = async () => {
    const titleInput = document.getElementById('editTitle');
    if(titleInput && getEditData()) getEditData().title = titleInput.value;

    if (await ensureAiAuth()) {
        const modal = document.getElementById('aiEditModal');
        const content = document.getElementById('aiEditModalContent');
        document.getElementById('aiEditPrompt').value = '';
        document.getElementById('aiEditLoading').classList.add('hidden');
        document.getElementById('aiEditButtons').classList.remove('hidden');
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            content.classList.remove('scale-95');
            document.getElementById('aiEditPrompt').focus();
        }, 10);
    }
};

window.closeAiEditModal = () => {
    const modal = document.getElementById('aiEditModal');
    const content = document.getElementById('aiEditModalContent');
    modal.classList.add('opacity-0');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 200);
};

window.submitAiEdit = async () => {
    const promptText = document.getElementById('aiEditPrompt').value.trim();
    if (!promptText) return window.showToast("Skriv in dina ändringar först!", "⚠️");

    const currentBoard = getEditData();
    if (!currentBoard) return window.showToast("Inget bräde är aktivt för redigering.", "❌");

    document.getElementById('aiEditButtons').classList.add('hidden');
    document.getElementById('aiEditLoading').classList.remove('hidden');
    document.getElementById('aiEditLoading').classList.add('flex');

    try {
        const apiKey = await ensureAiAuth();
        const systemPrompt = `Du är en expert på att skapa engagerande och språkligt rika frågesporter för skolelever, exakt i samma anda som TV-programmet 'På Spåret'.
Din uppgift är att skriva om, förbättra eller modifiera ett existerande quiz-paket baserat på användarens direkta feedback.

Krav för ditt svar:
1. Skapa/behåll exakt 5 stycken frågor ("boards"), om inte användaren uttryckligen ber om ett annat antal, men försök alltid ha 5.
2. Varje fråga måste ha exakt 5 ledtrådar i fallande svårighetsgrad (10p, 8p, 6p, 4p, 2p).
3. Språket och strukturen på de omskrivna eller nya ledtrådarna MÅSTE följa exakt samma poängmall (10p snirkligt, 2p extremt lätt).
4. Returnera ENDAST giltig JSON i exakt samma format som indatan. Inga markdown-taggar, ingen extra text.`;

        const userText = `Här är det nuvarande quiz-paketet (JSON):\n${JSON.stringify(currentBoard)}\n\nINSTRUKTION FÖR ÄNDRING:\n"${promptText}"`;
        
        await runMultiModelGeneration(apiKey, systemPrompt, userText, true);
        
        window.closeAiEditModal();
        document.getElementById('aiEditPrompt').value = '';
    } catch (e) {
        window.showToast(e.message || "Något gick fel med AI-redigeringen.", "❌");
    } finally {
        document.getElementById('aiEditLoading').classList.add('hidden');
        document.getElementById('aiEditLoading').classList.remove('flex');
        document.getElementById('aiEditButtons').classList.remove('hidden');
    }
};

// ==========================================
// 4. MULTI-MODEL RACE LOGIK
// ==========================================
async function runMultiModelGeneration(apiKey, systemPrompt, userText, isEditMode) {
    window.aiDrafts = []; 
    window.activeDraftIndex = 0; 
    window.isAiEditMode = isEditMode;
    let isFirstResolved = false;

    window.currentAiGenId = Date.now();
    const myGenId = window.currentAiGenId;
    
    if (window.aiAbortController) {
        window.aiAbortController.abort();
    }
    window.aiAbortController = new AbortController();
    const signal = window.aiAbortController.signal;

    const tasks = [
        { id: 'Flash 3 Preview', model: 'gemini-3-flash-preview', style: 'gemini' },
        { id: 'Flash 3.1 Lite', model: 'gemini-3.1-flash-lite-preview', style: 'gemini' },
        { id: 'Flash 2.5', model: 'gemini-2.5-flash', style: 'gemini' },
        { id: 'Gemma 3 (27B)', model: 'gemma-3-27b-it', style: 'gemma' },
        { id: 'Gemma 3 (12B)', model: 'gemma-3-12b-it', style: 'gemma' }
    ];

    return new Promise((resolve, reject) => {
        let failedCount = 0;

        tasks.forEach(task => {
            fetchAiModel(apiKey, systemPrompt, userText, task.model, signal)
                .then(response => {
                    if (window.currentAiGenId !== myGenId) return;

                    try {
                        const board = parseAiResponse(response, task.id);
                        window.aiDrafts.push({ board: board, info: task });
                        
                        // NOTERA: Sorteringen är nu borttagen. De sparas i den ordning de blir klara!

                        if (!isFirstResolved) {
                            isFirstResolved = true;
                            try {
                                applyAiBoard(board);
                                resolve(); 
                            } catch (renderError) {
                                console.error("Krasch vid utritning av AI-data:", renderError);
                                isFirstResolved = false; 
                                checkFail(++failedCount, reject);
                            }
                        } else {
                            if(typeof window.renderDraftSelector === 'function') {
                                window.renderDraftSelector();
                            }
                        }
                    } catch (parseErr) {
                        checkFail(++failedCount, reject);
                    }
                })
                .catch(err => {
                    if (err.name === 'AbortError' || window.currentAiGenId !== myGenId) return; 
                    checkFail(++failedCount, reject);
                });
        });

        function checkFail(count, rejectFn) {
            if (count === tasks.length && !isFirstResolved) {
                rejectFn(new Error("Alla 5 AI-anrop misslyckades. Servern kan vara överbelastad."));
            }
        }
    });
}

// ==========================================
// 5. HJÄLPFUNKTIONER (FETCH & PARSE)
// ==========================================
async function fetchAiModel(apiKey, systemInstruction, userText, modelName, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    let requestBody;

    if (modelName.includes("gemma")) {
        let finalPrompt = `INSTRUKTION TILL AI:\n${systemInstruction}\n\nANVÄNDARENS PROMPT:\n${userText}`;
        finalPrompt += `\n\nABSOLUT KRAV: Du får INTE tänka högt eller förklara. Börja direkt med tecknet {`;
        
        requestBody = {
            contents: [{ parts: [{ text: finalPrompt }] }],
            generationConfig: { temperature: 0.2 }
        };
    } else {
        requestBody = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ parts: [{ text: userText }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.8 }
        };
    }

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: signal
    });

    if (!response.ok) throw new Error(`API-fel: ${response.status}`);
    return await response.json();
}

function parseAiResponse(data, modelId) {
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error("API-svar saknar innehåll.");
    }
    
    const rawText = data.candidates[0].content.parts[0].text;
    
    try {
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        
        if (firstBrace === -1 || lastBrace === -1) {
            throw new Error("Kunde inte hitta några { } överhuvudtaget.");
        }
        
        let possibleJson = rawText.substring(firstBrace, lastBrace + 1);
        let board;

        try {
            let cleanAttempt = possibleJson.replace(/```json\n?/gi, '').replace(/```/g, '').trim();
            board = JSON.parse(cleanAttempt);
        } catch (initialError) {
            console.log(`🚑 Syntaxfel upptäckt i ${modelId}, skickar in jsonrepair...`);
            const repairedJson = jsonrepair(possibleJson);
            board = JSON.parse(repairedJson);
        }
        
        if (!board.title || !board.boards || !Array.isArray(board.boards) || board.boards.length === 0) {
            throw new Error(`Strukturfel. Paketnamn eller frågor saknas.`);
        }

        board.boards.forEach(b => {
            if (typeof b.answer !== 'string') b.answer = String(b.answer || "");
            if (!Array.isArray(b.clues)) b.clues = ["", "", "", "", ""];
            while(b.clues.length < 5) b.clues.push("");
        });

        return board;
        
    } catch (e) {
        throw e;
    }
}

// ==========================================
// 6. DRAFT HANTERING & UI
// ==========================================

export async function applyAiBoard(aiData) {
    if (window.isAiEditMode) {
        if (!window.originalBoardBackup) {
            window.originalBoardBackup = JSON.parse(JSON.stringify(getEditData()));
        }
        aiData.editIndex = window.originalBoardBackup.editIndex;
        setEditData(aiData);
        renderEditForm();
    } else {
        if (!window.originalBoardBackup) {
            window.originalBoardBackup = "NEW"; 
            boards.push(aiData);
            window.tempCurrentIndex = boards.length - 1;
        } else if (window.originalBoardBackup === "NEW") {
            boards[window.tempCurrentIndex] = aiData; 
        }
        setView('view', window.tempCurrentIndex);
    }
}

window.confirmDraftSelection = async () => {
    if (window.originalBoardBackup !== "NEW") {
        window.showToast("Alternativ valt! Du kan nu fortsätta redigera eller klicka 'Spara Ändringar'.", "✅");
    } else {
        saveBoards();
        window.showToast("Alternativ valt och sparat!", "🎉");
    }

    // Avbryt alla AI-anrop som fortfarande är på väg in, så att senare svar
    // inte återskapar alternativs-rutan efter att användaren redan har valt.
    if (window.aiAbortController) window.aiAbortController.abort();
    window.currentAiGenId = null;

    window.aiDrafts = [];
    window.activeDraftIndex = 0;
    window.originalBoardBackup = null;

    if (window.isAiEditMode) renderEditForm();
    else setView('view', window.tempCurrentIndex);
};

window.cancelDraftSelection = (isSilent = false) => {
    if (window.originalBoardBackup && window.originalBoardBackup !== "NEW") {
        setEditData(window.originalBoardBackup);
        if (!isSilent) renderEditForm();
    } else if (window.originalBoardBackup === "NEW") {
        boards.splice(window.tempCurrentIndex, 1);
        if (!isSilent) setView('welcome');
    }
    
    window.aiDrafts = [];
    window.activeDraftIndex = 0;
    window.originalBoardBackup = null;
    
    if (window.aiAbortController) window.aiAbortController.abort(); 
    
    if (!isSilent) window.showToast("AI-förslagen avfärdades.", "❌");
};

window.renderDraftSelector = () => {
    if (!window.aiDrafts || window.aiDrafts.length === 0) return;

    let container = document.getElementById('draftContainer');
    
    if (!container) {
        const wrapper = document.querySelector('#mainContent > div');
        if (wrapper) {
            container = document.createElement('div');
            container.id = 'draftContainer';
            if (wrapper.children.length > 1) {
                wrapper.insertBefore(container, wrapper.children[1]);
            } else {
                wrapper.insertBefore(container, wrapper.firstChild);
            }
        } else return;
    }

    container.innerHTML = '';
    
    const banner = document.createElement('div');
    banner.className = "bg-indigo-50 border border-indigo-200 rounded-lg p-3 my-4 flex items-center gap-3 flex-wrap shadow-sm relative";
    
    const label = document.createElement('span');
    label.className = "text-sm font-bold text-indigo-800 flex items-center gap-2 mr-2";
    label.innerHTML = "✨ Genererade AI-alternativ:";
    banner.appendChild(label);

    window.aiDrafts.forEach((draft, idx) => {
        const isActive = (window.activeDraftIndex === idx);
        const btn = document.createElement('button');
        
        // Sätt position 'relative' på knappen så att stjärnan kan fästas absolut till den
        if (isActive) {
            btn.className = "relative px-4 py-2 text-sm font-black text-white bg-indigo-600 rounded-md shadow-md ring-2 ring-indigo-400 ring-offset-1 transition-all";
        } else {
            btn.className = "relative px-4 py-2 text-sm font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md shadow-sm transition-all";
        }
        
        btn.textContent = `Alt ${idx + 1}`;
        
        // Logik för den lilla stjärnan (om det är Flash 3 eller 3.1)
        const isPremiumModel = draft.info.id.includes('Flash 3');
        if (isPremiumModel) {
            const star = document.createElement('div');
            star.className = "absolute -top-2 -right-2 z-10 pointer-events-none"; // Placerar den uppe i högra hörnet
            // En snygg SVG-stjärna med gul fyllning och svart ram
            star.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#facc15" stroke="#0f172a" stroke-width="2" class="w-5 h-5 drop-shadow-sm"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            btn.appendChild(star);
        }

        btn.onclick = () => {
            if (window.activeDraftIndex === idx) return; 
            
            window.activeDraftIndex = idx;
            const draftBoard = JSON.parse(JSON.stringify(draft.board));
            
            applyAiBoard(draftBoard); 
        };

        banner.appendChild(btn);
    });

    container.appendChild(banner);
};
