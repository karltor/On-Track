import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { jsonrepair } from "jsonrepair";

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const REGION = "europe-west1";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------
// Gemma 4 model ids per https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
// If an id is wrong the request 404s and that model is silently dropped from the
// race, so the app keeps working with the remaining models.
const GEMMA4_31B = "gemma-4-31b-it";
const GEMMA4_26B = "gemma-4-26b-a4b-it";

const MODELS = {
  "gemini-3-flash-preview":        { label: "Flash 3 Preview", style: "gemini", premium: true },
  "gemini-3.1-flash-lite-preview": { label: "Flash 3.1 Lite",  style: "gemini", premium: true },
  "gemini-2.5-flash":              { label: "Flash 2.5",       style: "gemini", premium: true },
  "gemma-3-27b-it":                { label: "Gemma 3 (27B)",   style: "gemma",  bucket: "gemma3" },
  "gemma-3-12b-it":                { label: "Gemma 3 (12B)",   style: "gemma",  bucket: "gemma3" },
  [GEMMA4_31B]:                    { label: "Gemma 4 (31B)",   style: "gemma4", bucket: "gemma4-31b" },
  [GEMMA4_26B]:                    { label: "Gemma 4 (26B)",   style: "gemma4", bucket: "gemma4-26b" },
};

const STAFF_MODELS = Object.keys(MODELS);
const ANON_MODELS = Object.keys(MODELS).filter((m) => MODELS[m].style !== "gemini");

// Daily caps
const USER_DAILY = { staff: 500, anon: 50 };
// Global per-bucket caps that only apply to anonymous (guest) traffic.
const GLOBAL_CAPS = {
  gemma3: 10000,
  "gemma4-31b": 5000,
  "gemma4-26b": 1000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function tierForToken(token) {
  const email = (token?.email || "").toLowerCase();
  if (!email) return "anon";
  const prefix = email.split("@")[0];
  const eligible =
    email.endsWith("@nyamunken.se") && !/\d{3}/.test(prefix) && token.email_verified === true;
  return eligible ? "staff" : "anon";
}

function buildBody(modelName, systemInstruction, userText, { prefill = false } = {}) {
  const meta = MODELS[modelName];

  if (meta.style === "gemini") {
    return {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
    };
  }

  // gemma / gemma4 — no system role, concatenated prompt.
  let prompt = `INSTRUKTION TILL AI:\n${systemInstruction}\n\nANVÄNDARENS PROMPT:\n${userText}`;
  prompt += `\n\nABSOLUT KRAV: Du får INTE tänka högt eller förklara. Börja direkt med tecknet {`;

  if (meta.style === "gemma4") {
    if (prefill) {
      prompt += `\n\nVIKTIGT: Du har VÄLDIGT få tokens kvar. Tänk INTE alls. Fortsätt och skriv klart JSON-objektet nu.`;
      return {
        contents: [
          { role: "user", parts: [{ text: prompt }] },
          { role: "model", parts: [{ text: "{" }] },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      };
    }
    return {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    };
  }

  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
  };
}

async function callRaw(modelName, body, apiKey) {
  const res = await fetch(`${API_BASE}/${modelName}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status} for ${modelName}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
  return { text, finishReason: cand?.finishReason || "" };
}

// Port of the client-side parseAiResponse: extract { ... }, repair, validate.
function parseBoard(rawText) {
  const first = rawText.indexOf("{");
  const last = rawText.lastIndexOf("}");
  if (first === -1) throw new Error("Inget { hittades i svaret.");

  // If the closing brace is missing (truncated), keep from first { and let jsonrepair finish it.
  const slice = last > first ? rawText.substring(first, last + 1) : rawText.substring(first);

  let board;
  try {
    const cleaned = slice.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
    board = JSON.parse(cleaned);
  } catch {
    board = JSON.parse(jsonrepair(slice));
  }

  if (!board.title || !Array.isArray(board.boards) || board.boards.length === 0) {
    throw new Error("Strukturfel: paketnamn eller frågor saknas.");
  }
  for (const b of board.boards) {
    if (typeof b.answer !== "string") b.answer = String(b.answer || "");
    if (!Array.isArray(b.clues)) b.clues = ["", "", "", "", ""];
    while (b.clues.length < 5) b.clues.push("");
  }
  return board;
}

async function generateWithModel(modelName, systemInstruction, userText, apiKey) {
  const meta = MODELS[modelName];

  // First attempt.
  let { text, finishReason } = await callRaw(
    modelName,
    buildBody(modelName, systemInstruction, userText),
    apiKey
  );

  try {
    return parseBoard(text);
  } catch (err) {
    // For Gemma 4 the typical failure is the thinking budget eating the output
    // tokens before the JSON closes. Retry once with a prefilled "{" model turn
    // so it continues the object directly instead of reasoning.
    if (meta.style === "gemma4") {
      const second = await callRaw(
        modelName,
        buildBody(modelName, systemInstruction, userText, { prefill: true }),
        apiKey
      );
      return parseBoard("{" + second.text);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Callable
// ---------------------------------------------------------------------------
export const generateBoard = onCall(
  { region: REGION, secrets: [GEMINI_API_KEY], timeoutSeconds: 540, memory: "256MiB" },
  async (request, response) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Du måste vara inloggad (eller anonym).");
    }
    const uid = request.auth.uid;
    const tier = tierForToken(request.auth.token);

    const { mode, systemPrompt, userText } = request.data || {};
    if (mode !== "create" && mode !== "edit") {
      throw new HttpsError("invalid-argument", "Ogiltigt läge.");
    }
    if (typeof systemPrompt !== "string" || typeof userText !== "string") {
      throw new HttpsError("invalid-argument", "Saknar prompt.");
    }
    if (systemPrompt.length > 12000 || userText.length > 20000) {
      throw new HttpsError("invalid-argument", "Prompten är för lång.");
    }

    const day = todayKey();
    const candidates = tier === "staff" ? STAFF_MODELS : ANON_MODELS;

    // --- Limit enforcement (transaction) ---
    const userRef = db.collection("ai_usage").doc(uid);
    const globalRef = db.collection("ai_global").doc(day);

    let allowedModels;
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const globalSnap = tier === "anon" ? await tx.get(globalRef) : null;

      const u = userSnap.exists ? userSnap.data() : {};
      const sameDay = u.date === day;
      const used = sameDay ? u.count || 0 : 0;
      if (used >= USER_DAILY[tier]) {
        throw new HttpsError(
          "resource-exhausted",
          tier === "staff"
            ? "Du har nått dagsgränsen för AI-generering."
            : "USER_LIMIT"
        );
      }

      // Filter out globally-exhausted buckets (anon only).
      if (tier === "anon") {
        const g = globalSnap.exists ? globalSnap.data() : {};
        allowedModels = candidates.filter((m) => {
          const bucket = MODELS[m].bucket;
          if (!bucket || GLOBAL_CAPS[bucket] == null) return true;
          return (g[bucket] || 0) < GLOBAL_CAPS[bucket];
        });
        if (allowedModels.length === 0) {
          throw new HttpsError("resource-exhausted", "GLOBAL_LIMIT");
        }
      } else {
        allowedModels = candidates.slice();
      }

      // Reserve usage now (conservative: count attempts, don't refund failures).
      tx.set(userRef, { date: day, count: used + 1 }, { merge: true });

      if (tier === "anon") {
        const incPerBucket = {};
        for (const m of allowedModels) {
          const b = MODELS[m].bucket;
          if (b && GLOBAL_CAPS[b] != null) incPerBucket[b] = (incPerBucket[b] || 0) + 1;
        }
        const g = globalSnap.exists ? globalSnap.data() : {};
        const update = { date: day };
        for (const [b, inc] of Object.entries(incPerBucket)) update[b] = (g[b] || 0) + inc;
        tx.set(globalRef, update, { merge: true });
      }
    });

    // --- Fan out to the allowed models, streaming each result as it lands ---
    const apiKey = GEMINI_API_KEY.value();
    const drafts = [];
    const errors = [];
    const emit = (obj) => {
      if (response && typeof response.sendChunk === "function") response.sendChunk(obj);
    };
    await Promise.allSettled(
      allowedModels.map(async (modelName) => {
        try {
          const board = await generateWithModel(modelName, systemPrompt, userText, apiKey);
          const draft = {
            board,
            info: {
              id: MODELS[modelName].label,
              model: modelName,
              style: MODELS[modelName].style,
              premium: !!MODELS[modelName].premium,
            },
          };
          drafts.push(draft);
          emit({ draft });
        } catch (err) {
          const message = (err && err.message) ? err.message : String(err);
          console.warn(`Model ${modelName} failed:`, message);
          errors.push({ model: modelName, message });
          emit({ error: { model: modelName, message } });
        }
      })
    );

    if (drafts.length === 0) {
      throw new HttpsError(
        "internal",
        "Alla AI-anrop misslyckades. " + errors.map((e) => `${e.model}: ${e.message}`).join(" | ")
      );
    }

    return { tier, drafts, errors };
  }
);
