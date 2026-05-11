import { auth, authReady, functions, boards, saveBoards, setView, getEditData, setEditData, renderEditForm } from './admin.js';
import { GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";

const generateBoardFn = httpsCallable(functions, 'generateBoard');

// Draft State
window.aiDrafts = [];
window.activeDraftIndex = 0;
window.originalBoardBackup = null;
window.isAiEditMode = false;
window.tempCurrentIndex = -1;
window.currentAiGenId = null;
window.aiAbortController = null;

// ==========================================
// 1. AUTENTISERING / TIER
// ==========================================
// En giltig lärar-adress: @nyamunken.se utan tre siffror i rad i prefixet.
function isEligibleStaffEmail(email) {
    if (!email) return false;
    const e = email.toLowerCase();
    const prefix = e.split('@')[0];
    return e.endsWith('@nyamunken.se') && !/\d{3}/.test(prefix);
}

export function currentTier() {
    const u = auth.currentUser;
    if (u && !u.isAnonymous && isEligibleStaffEmail(u.email)) return 'staff';
    return 'anon';
}

// Säkerställer att vi har NÅGON inloggning (anonym räcker). Returnerar tier.
async function ensureAiSignedIn() {
    try { await authReady; } catch (_) { /* timeout – fortsätt ändå */ }
    if (!auth.currentUser) {
        await signInAnonymously(auth);
    }
    return currentTier();
}

// CTA: logga in som Nya Munken-personal för premium-AI.
window.signInAsStaff = async () => {
    try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ hd: 'nyamunken.se' });
        const result = await signInWithPopup(auth, provider);
        const email = (result.user.email || '').toLowerCase();
        if (!isEligibleStaffEmail(email)) {
            await auth.signOut();
            await signInAnonymously(auth);
            window.showToast("Endast Nya Munken-personal har lärarkonton.", "🚫");
        } else {
            window.showToast("Inloggad som lärare – premium-AI aktiv!", "✅");
        }
    } catch (e) {
        if (e && e.code !== 'auth/popup-closed-by-user') {
            window.showToast("Inloggningen misslyckades.", "❌");
        }
    }
    updateAuthUi();
};

window.signOutToGuest = async () => {
    try { await auth.signOut(); } catch (_) {}
    try { await signInAnonymously(auth); } catch (_) {}
    window.showToast("Utloggad. Du genererar nu som gäst.", "👋");
    updateAuthUi();
};

// ==========================================
// 1b. LOGIN-CTA / BANNER UI
// ==========================================
export function updateAuthUi() {
    const tier = currentTier();
    const chip = document.getElementById('staffLoginChip');
    const status = document.getElementById('staffStatusChip');
    if (chip) chip.classList.toggle('hidden', tier === 'staff');
    if (status) status.classList.toggle('hidden', tier !== 'staff');
    fillAccessBanner('aiAccessBanner', tier);
    fillAccessBanner('aiEditAccessBanner', tier);
}

function fillAccessBanner(id, tier) {
    const el = document.getElementById(id);
    if (!el) return;
    if (tier === 'staff') {
        el.className = "text-xs rounded-lg p-3 mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-between gap-2";
        el.innerHTML = `<span>✅ Inloggad som Nya Munken-personal. Anropen räknas mot lärarbudgeten.</span><button onclick="signOutToGuest()" class="font-bold underline hover:no-underline shrink-0">Logga ut</button>`;
    } else {
        el.className = "text-xs rounded-lg p-3 mb-4 bg-indigo-50 border border-indigo-200 text-indigo-800 flex items-center justify-between gap-3";
        el.innerHTML = `<span>💼 Du genererar som gäst (delar månadsbudget med andra gäster, max 50/dag per användare). Jobbar du på Nya Munken?</span><button onclick="signInAsStaff()" class="shrink-0 font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-500 transition">Logga in</button>`;
    }
}

// Håll inloggnings-UI:t i synk.
onAuthStateChanged(auth, () => updateAuthUi());
authReady.then(() => updateAuthUi()).catch(() => updateAuthUi());

// ==========================================
// 1c. BUDGET-DIALOG (när månadsbudgeten är slut)
// ==========================================
window.openBudgetExhaustedModal = (tier) => {
    const modal = document.getElementById('budgetModal');
    const content = document.getElementById('budgetModalContent');
    const body = document.getElementById('budgetModalBody');
    if (!modal || !body) {
        window.showToast(tier === 'staff' ? "Månadens lärar-AI-budget är slut." : "Månadens gäst-AI-budget är slut.", "💸");
        return;
    }
    if (tier === 'staff') {
        body.innerHTML = `
            <p class="mb-3"><strong>Lärarbudgeten (~50 kr/mån) är förbrukad.</strong> AI-generering pausas tills nästa månad, eller tills spend-limit för Google Cloud-projektet höjs.</p>
            <p class="text-slate-600">Tills dess kan du skapa bräden manuellt:</p>`;
    } else {
        body.innerHTML = `
            <p class="mb-3"><strong>Gästernas delade AI-budget för månaden är slut.</strong> Inloggade Nya Munken-lärare kan fortsätta använda AI, men som gäst kan du tyvärr inte generera bräden via AI just nu.</p>
            <p class="text-slate-600">Du kan ändå göra ett bräde med <em>vilken som helst</em> chattbot (ChatGPT, Claude, Gemini.com, etc.) och importera resultatet:</p>`;
    }
    body.innerHTML += `
        <ol class="list-decimal pl-5 mt-3 space-y-2 text-slate-700">
            <li>Öppna ett befintligt bräde och klicka på <strong>"Exportera paket → Kopiera JSON-kod"</strong> för att få JSON-mallen.</li>
            <li>Klistra in JSON:en i din chattbot tillsammans med din önskan, t.ex.: <em>"Skriv om detta paket så att det handlar om Europas huvudstäder. Returnera EXAKT samma JSON-format."</em></li>
            <li>Kopiera chattbottens JSON-svar.</li>
            <li>Klicka på <strong>"Klistra in JSON"</strong> uppe i högra hörnet här i appen och klistra in.</li>
        </ol>`;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        if (content) content.classList.remove('scale-95');
    }, 10);
};

window.closeBudgetExhaustedModal = () => {
    const modal = document.getElementById('budgetModal');
    const content = document.getElementById('budgetModalContent');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 200);
};

window.openImportFromBudgetModal = () => {
    window.closeBudgetExhaustedModal();
    if (typeof setView === 'function') setView('import');
};

// ==========================================
// 2. SKAPA NYTT BRÄDE MED AI
// ==========================================
window.openAiModal = async () => {
    await ensureAiSignedIn();
    updateAuthUi();

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

function setAiLoadingText(loadingElId /*, tier */) {
    const p = document.querySelector(`#${loadingElId} p`);
    if (!p) return;
    p.textContent = 'AI:n tänker (ca 10–15 sekunder)...';
}

window.generateAiBoard = async () => {
    const promptText = document.getElementById('aiPrompt').value.trim();
    if (!promptText) return window.showToast("Skriv in ett tema först!", "⚠️");

    document.getElementById('aiButtons').classList.add('hidden');
    document.getElementById('aiLoading').classList.remove('hidden');
    document.getElementById('aiLoading').classList.add('flex');

    try {
        const tier = await ensureAiSignedIn();
        setAiLoadingText('aiLoading', tier);
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

        await runAiGeneration('create', systemPrompt, userText, false);

        window.closeAiModal();
        document.getElementById('aiPrompt').value = '';
    } catch (e) {
        if (e && e.budgetExhausted) { window.closeAiModal(); window.openBudgetExhaustedModal(e.tier); }
        else window.showToast(e.message || "Något gick fel med AI-anropet.", "❌");
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
    if (titleInput && getEditData()) getEditData().title = titleInput.value;

    await ensureAiSignedIn();
    updateAuthUi();

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
        const tier = await ensureAiSignedIn();
        setAiLoadingText('aiEditLoading', tier);
        const systemPrompt = `Du är en expert på att skapa engagerande och språkligt rika frågesporter för skolelever, exakt i samma anda som TV-programmet 'På Spåret'.
Din uppgift är att skriva om, förbättra eller modifiera ett existerande quiz-paket baserat på användarens direkta feedback.

Krav för ditt svar:
1. Skapa/behåll exakt 5 stycken frågor ("boards"), om inte användaren uttryckligen ber om ett annat antal, men försök alltid ha 5.
2. Varje fråga måste ha exakt 5 ledtrådar i fallande svårighetsgrad (10p, 8p, 6p, 4p, 2p).
3. Språket och strukturen på de omskrivna eller nya ledtrådarna MÅSTE följa exakt samma poängmall (10p snirkligt, 2p extremt lätt).
4. Returnera ENDAST giltig JSON i exakt samma format som indatan. Inga markdown-taggar, ingen extra text.`;

        const userText = `Här är det nuvarande quiz-paketet (JSON):\n${JSON.stringify(currentBoard)}\n\nINSTRUKTION FÖR ÄNDRING:\n"${promptText}"`;

        await runAiGeneration('edit', systemPrompt, userText, true);

        window.closeAiEditModal();
        document.getElementById('aiEditPrompt').value = '';
    } catch (e) {
        if (e && e.budgetExhausted) { window.closeAiEditModal(); window.openBudgetExhaustedModal(e.tier); }
        else window.showToast(e.message || "Något gick fel med AI-redigeringen.", "❌");
    } finally {
        document.getElementById('aiEditLoading').classList.add('hidden');
        document.getElementById('aiEditLoading').classList.remove('flex');
        document.getElementById('aiEditButtons').classList.remove('hidden');
    }
};

// ==========================================
// 4. AI-GENERERING VIA CLOUD FUNCTION
// ==========================================
// Konverterar ett Firebase-funktionsfel till ett `Error` vi kan kasta vidare.
// För budget-tomma fall sätts `.budgetExhausted` + `.tier` så att anroparen kan
// öppna budget-dialogen i stället för att toasta.
function mapAiError(e) {
    const code = e && e.code;
    const msg = (e && e.message) || '';
    if (code === 'functions/resource-exhausted') {
        if (msg === 'BUDGET_EXHAUSTED_ANON' || msg === 'BUDGET_EXHAUSTED_STAFF') {
            const err = new Error(msg);
            err.budgetExhausted = true;
            err.tier = msg === 'BUDGET_EXHAUSTED_ANON' ? 'anon' : 'staff';
            return err;
        }
        if (msg === 'USER_LIMIT') return new Error("Du har nått dagsgränsen (50 AI-bräden idag som gäst). Försök igen imorgon eller logga in som Nya Munken-personal.");
        if (msg === 'STAFF_USER_LIMIT') return new Error("Du har nått dagsgränsen för AI-generering.");
        return new Error(msg || "Dagsgränsen för AI-generering är nådd.");
    }
    if (code === 'functions/unauthenticated') return new Error("Du är inte inloggad. Ladda om sidan och försök igen.");
    if (code === 'functions/invalid-argument') return new Error(msg || "Ogiltig förfrågan.");
    return new Error(msg || "Något gick fel med AI-anropet. Servern kan vara överbelastad.");
}

// Tar emot ett färdigt AI-utkast. Det FÖRSTA som kommer in ritas ut direkt;
// efterföljande utkast dyker upp som val i draft-väljaren. Returnerar true om
// detta var det första (= dags att stänga modalen).
function handleIncomingDraft(draft) {
    if (!draft || !draft.board) return false;
    const isFirst = window.aiDrafts.length === 0;
    const info = draft.info || {};
    console.log(`[AI] ✅ utkast klart från: ${info.id || '?'} (${info.model || '?'})${info.premium ? ' ⭐' : ''}`);
    window.aiDrafts.push({ board: draft.board, info: info });
    if (isFirst) {
        try {
            applyAiBoard(JSON.parse(JSON.stringify(draft.board)));
        } catch (renderError) {
            console.error("Krasch vid utritning av AI-data:", renderError);
            window.aiDrafts.pop();
            return false;
        }
        return true;
    }
    if (typeof window.renderDraftSelector === 'function') window.renderDraftSelector();
    return false;
}

function runAiGeneration(mode, systemPrompt, userText, isEditMode) {
    window.aiDrafts = [];
    window.activeDraftIndex = 0;
    window.isAiEditMode = isEditMode;
    window.currentAiGenId = Date.now();
    const myGenId = window.currentAiGenId;
    const isCurrent = () => window.currentAiGenId === myGenId;

    return new Promise((resolve, reject) => {
        let settled = false;
        const succeed = () => { if (!settled) { settled = true; resolve(); } };
        const failWith = (e) => {
            if (settled) return;
            settled = true;
            // mapAiError always returns an Error; pass through if already mapped.
            reject(e && e.budgetExhausted ? e : mapAiError(e));
        };

        (async () => {
            let streamResult;
            try {
                // Streamande callable: får utkasten ett i taget allt eftersom modellerna blir klara.
                streamResult = await generateBoardFn.stream({ mode, systemPrompt, userText });
            } catch (e) {
                return failWith(e);
            }

            let gotChunks = false;
            try {
                for await (const chunk of streamResult.stream) {
                    if (!isCurrent()) return;
                    gotChunks = true;
                    if (chunk && chunk.error) {
                        console.warn(`[AI] ❌ modell misslyckades: ${chunk.error.model} – ${chunk.error.message}`);
                        continue;
                    }
                    if (handleIncomingDraft(chunk && chunk.draft)) succeed();
                }
            } catch (_) {
                // Streaming kanske inte stöds i denna miljö – vi faller tillbaka på .data nedan.
            }

            let data;
            try {
                data = await streamResult.data;
            } catch (e) {
                return failWith(e);
            }
            if (!isCurrent()) return;

            // Fallback: om inga chunks kom in, använd den fullständiga payloaden.
            if (window.aiDrafts.length === 0) {
                const drafts = (data && Array.isArray(data.drafts)) ? data.drafts : [];
                for (const d of drafts) {
                    if (handleIncomingDraft(d)) succeed();
                }
            }
            if (!gotChunks && data && Array.isArray(data.errors) && data.errors.length) {
                data.errors.forEach(er => console.warn(`[AI] ❌ modell misslyckades: ${er.model} – ${er.message}`));
            }
            console.log(`[AI] klart – ${window.aiDrafts.length} förslag, ${(data && data.errors && data.errors.length) || 0} misslyckade modeller.`);

            if (window.aiDrafts.length === 0) {
                return failWith(new Error("AI:n kunde inte skapa något bräde. Försök igen."));
            }
            succeed(); // säkerhetsnät om handleIncomingDraft aldrig hann anropa succeed()
        })();
    });
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
    window.currentAiGenId = null;

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

        if (isActive) {
            btn.className = "relative px-4 py-2 text-sm font-black text-white bg-indigo-600 rounded-md shadow-md ring-2 ring-indigo-400 ring-offset-1 transition-all";
        } else {
            btn.className = "relative px-4 py-2 text-sm font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md shadow-sm transition-all";
        }

        btn.textContent = `Alt ${idx + 1}`;

        // Liten stjärna för premium-modeller (Gemini).
        const isPremiumModel = !!(draft.info && draft.info.premium);
        if (isPremiumModel) {
            const star = document.createElement('div');
            star.className = "absolute -top-2 -right-2 z-10 pointer-events-none";
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
