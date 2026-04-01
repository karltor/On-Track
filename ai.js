import { db, auth, boards, saveBoards, setView, getEditData, setEditData, renderEditForm } from './admin.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";
import { GoogleAuthProvider, signInWithPopup, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

let geminiApiKey = null;

// Gemensam funktion för att säkerställa att läraren är verifierad innan AI används
async function ensureAiAuth() {
    if (geminiApiKey) return true;

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: 'nyamunken.se' }); 
    
    try {
        window.showToast("Väntar på inloggning...", "⏳");
        const result = await signInWithPopup(auth, provider);
        const email = result.user.email;
        
        const emailPrefix = email.split('@')[0];
        const isNyamunken = email.endsWith('@nyamunken.se');
        const hasThreeDigits = /\d{3}/.test(emailPrefix); 

        if (isNyamunken && !hasThreeDigits) {
            try {
                const keyDoc = await getDoc(doc(db, "secrets", "gemini"));
                if (keyDoc.exists() && keyDoc.data().key) {
                    geminiApiKey = keyDoc.data().key;
                    window.showToast("Inloggad som lärare!", "✅");
                    return true;
                } else {
                    window.showToast("Hittade ingen API-nyckel i databasen.", "❌");
                    return false;
                }
            } catch (firestoreError) {
                console.error("Fel vid hämtning av nyckel:", firestoreError);
                window.showToast("Du har inte behörighet att läsa AI-nyckeln.", "❌");
                return false;
            }
        } else {
            await auth.signOut();
            signInAnonymously(auth); 
            alert(`Åtkomst nekad för kontot: ${email}.\nEndast lärarkonton från nyamunken.se har tillgång till AI-generering.`);
            return false;
        }
    } catch (error) {
        console.error("Inloggningsfel:", error);
        if(error.code !== 'auth/popup-closed-by-user') {
            window.showToast("Inloggningen misslyckades.", "❌");
        }
        return false;
    }
}

// ------------------------------------
// SKAPA NYTT BRÄDE
// ------------------------------------
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
    if (!promptText) {
        window.showToast("Skriv in ett tema först!", "⚠️");
        return;
    }

    document.getElementById('aiLoading').classList.remove('hidden');
    document.getElementById('aiLoading').classList.add('flex');
    document.getElementById('aiButtons').classList.add('hidden');

    const systemInstruction = `Du är en expert på att skapa engagerande och språkligt rika frågesporter för skolelever, exakt i samma anda som TV-programmet 'På Spåret'.
Skapa ett quizpaket om ämnet: "${promptText}". 

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

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction }] }],
                generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
            })
        });

        if (!response.ok) throw new Error(`API returnerade status ${response.status}`);

        const data = await response.json();
        let aiText = data.candidates[0].content.parts[0].text;
        
        // --- SKOTTSÄKER JSON EXTRAHERARE ---
        // Hitta var objektet börjar och slutar, klipp bort allt skräp runtomkring.
        const startIndex = aiText.indexOf('{');
        const endIndex = aiText.lastIndexOf('}');
        if (startIndex !== -1 && endIndex !== -1) {
            aiText = aiText.substring(startIndex, endIndex + 1);
        }
        
        const generatedBoard = JSON.parse(aiText);

        boards.push(generatedBoard);
        saveBoards();
        
        window.closeAiModal();
        window.showToast("AI-brädet har skapats!", "🎉");
        setView('view', boards.length - 1);

    } catch (error) {
        console.error("AI Error:", error);
        window.showToast("Något gick fel med AI-genereringen.", "❌");
        document.getElementById('aiLoading').classList.add('hidden');
        document.getElementById('aiLoading').classList.remove('flex');
        document.getElementById('aiButtons').classList.remove('hidden');
    }
};


// ------------------------------------
// REDIGERA BEFINTLIGT BRÄDE
// ------------------------------------
window.openAiEditModal = async () => {
    // Säkra upp eventuella pågående ändringar i formuläret så AI:n får det senaste!
    const titleInput = document.getElementById('editTitle');
    if(titleInput) getEditData().title = titleInput.value;

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
    if (!promptText) {
        window.showToast("Skriv in dina ändringar först!", "⚠️");
        return;
    }

    const currentBoard = getEditData();

    document.getElementById('aiEditLoading').classList.remove('hidden');
    document.getElementById('aiEditLoading').classList.add('flex');
    document.getElementById('aiEditButtons').classList.add('hidden');

    const systemInstruction = `Du är en expert på att skapa engagerande och språkligt rika frågesporter för skolelever, exakt i samma anda som TV-programmet 'På Spåret'.
Din uppgift är att skriva om, förbättra eller modifiera ett existerande quiz-paket baserat på användarens direkta feedback.

Användarens feedback (vad som ska ändras):
"${promptText}"

Här är det nuvarande quiz-paketet (JSON):
${JSON.stringify(currentBoard, null, 2)}

Krav för ditt svar:
1. Skapa/behåll exakt 5 stycken frågor ("boards"), om inte användaren uttryckligen ber om ett annat antal, men försök alltid ha 5.
2. Varje fråga måste ha exakt 5 ledtrådar i fallande svårighetsgrad (10p, 8p, 6p, 4p, 2p).
3. Språket och strukturen på de omskrivna eller nya ledtrådarna MÅSTE följa denna exakta mall:
   - 10p: Mycket extravagant, akademiskt, snirkligt och rikt språk. Kryptiskt men faktamässigt korrekt. Använd avancerade synonymer. (Minst 20-30 ord).
   - 8p: Fortfarande avancerat, ofta med historisk kontext, specifika namn, årtal eller djupare detaljer. (Ca 15-25 ord).
   - 6p: Medelsvårt. Kopplar till välkända exempel, bredare fakta eller kända anekdoter. (Ca 15-20 ord).
   - 4p: Standarddefinitionen, som hämtad ur en skolbok. Tydligt och rakt på sak. (Ca 10-15 ord).
   - 2p: Mycket lätt och direkt. Ge nästan bort svaret helt, t.ex. genom första bokstaven, en extremt känd egenskap eller förkortning. (Ca 8-12 ord).

4. Returnera ENDAST giltig JSON i exakt samma format som indatan. Inga markdown-taggar, ingen extra text.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction }] }],
                generationConfig: { temperature: 0.7, responseMimeType: "application/json" }
            })
        });

        if (!response.ok) throw new Error(`API returnerade status ${response.status}`);

        const data = await response.json();
        let aiText = data.candidates[0].content.parts[0].text;
        
        // --- SKOTTSÄKER JSON EXTRAHERARE ---
        const startIndex = aiText.indexOf('{');
        const endIndex = aiText.lastIndexOf('}');
        if (startIndex !== -1 && endIndex !== -1) {
            aiText = aiText.substring(startIndex, endIndex + 1);
        }
        
        const updatedBoard = JSON.parse(aiText);

        // Se till att bevara "editIndex" så vi inte råkar skapa ett nytt bräde när vi sparar sen!
        updatedBoard.editIndex = currentBoard.editIndex;
        
        // Uppdatera formuläret och rendera om!
        setEditData(updatedBoard);
        renderEditForm();
        
        window.closeAiEditModal();
        window.showToast("Ditt bräde har redigerats!", "✨");

    } catch (error) {
        console.error("AI Error:", error);
        window.showToast("Något gick fel med AI-redigeringen.", "❌");
        document.getElementById('aiEditLoading').classList.add('hidden');
        document.getElementById('aiEditLoading').classList.remove('flex');
        document.getElementById('aiEditButtons').classList.remove('hidden');
    }
};
