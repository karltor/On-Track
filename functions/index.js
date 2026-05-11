import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { jsonrepair } from "jsonrepair";

initializeApp();
const db = getFirestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const REGION = "europe-west1";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ---------------------------------------------------------------------------
// Model catalogue — same list for guests and staff. All are fast Gemini Flash
// models that handle JSON output natively.
// ---------------------------------------------------------------------------
const MODELS = {
  "gemini-3-flash-preview":                { label: "Gemini 3 Flash Preview",       style: "gemini" },
  "gemini-3.1-flash-lite":                 { label: "Gemini 3.1 Flash Lite",        style: "gemini" },
  "gemini-3.1-flash-lite-preview":         { label: "Gemini 3.1 Flash Lite Preview", style: "gemini" },
  "gemini-2.5-flash-lite":                 { label: "Gemini 2.5 Flash Lite",        style: "gemini" },
};
const ALL_MODELS = Object.keys(MODELS);

// Per-user daily safeguard so one user can't drain the shared monthly budget
// in five minutes. (Applies on top of the monthly budget below.)
const USER_DAILY = { staff: 500, anon: 50 };

// Shared monthly spend budgets (SEK) — one shared pool for all guests, one for
// all staff. UTC month key. Resets automatically at month rollover.
const MONTHLY_BUDGET_SEK = { anon: 30, staff: 50 };

// Verified against https://ai.google.dev/gemini-api/docs/pricing#standard
// USD per 1 000 000 tokens. Tune if Google changes prices.
const PRICING_USD_PER_M = {
  "gemini-3-flash-preview":                { in: 0.50, out: 3.00 },
  "gemini-3.1-flash-lite":                 { in: 0.25, out: 1.50 },
  "gemini-3.1-flash-lite-preview":         { in: 0.25, out: 1.50 },
  "gemini-2.5-flash-lite":                 { in: 0.10, out: 0.40 },
};
const SEK_PER_USD = 9.5;

// A single model call is abandoned after this long.
const CALL_TIMEOUT_MS = 70000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}
function monthKey() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM, UTC
}

function tierForToken(token) {
  const email = (token?.email || "").toLowerCase();
  if (!email) return "anon";
  const prefix = email.split("@")[0];
  const eligible =
    email.endsWith("@nyamunken.se") && !/\d{3}/.test(prefix) && token.email_verified === true;
  return eligible ? "staff" : "anon";
}

function buildBody(systemInstruction, userText) {
  return {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
  };
}

function computeCostSek(modelName, usage) {
  const price = PRICING_USD_PER_M[modelName];
  if (!price || !usage) return 0;
  const inTok = usage.promptTokenCount || 0;
  const outTok = usage.candidatesTokenCount || 0;
  const usd = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
  return usd * SEK_PER_USD;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callRaw(modelName, body, apiKey, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}/${modelName}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const why = ctrl.signal.aborted ? `timeout efter ${CALL_TIMEOUT_MS / 1000}s` : `nätverksfel (${e?.message || e})`;
    if (attempt < 1) {
      await sleep(1000 + Math.random() * 1000);
      return callRaw(modelName, body, apiKey, attempt + 1);
    }
    throw new Error(why);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(2500 * (attempt + 1) + Math.random() * 1000);
      return callRaw(modelName, body, apiKey, attempt + 1);
    }
    throw new Error(`API ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const finishReason = cand?.finishReason || "";
  const text = cand?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) {
    const block = data?.promptFeedback?.blockReason || finishReason || "okänd";
    throw new Error(`tomt svar (finishReason=${finishReason || "?"}, block=${block})`);
  }
  return { text, finishReason, usage: data.usageMetadata || null };
}

function parseBoard(rawText) {
  const first = rawText.indexOf("{");
  const last = rawText.lastIndexOf("}");
  if (first === -1) throw new Error("Inget { hittades i svaret.");

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
  const { text, usage } = await callRaw(modelName, buildBody(systemInstruction, userText), apiKey);
  return { board: parseBoard(text), usage };
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
    const month = monthKey();

    const userRef = db.collection("ai_usage").doc(uid);
    const spendRef = db.collection("ai_spend").doc(month);

    // --- Pre-flight checks in a transaction: daily count + monthly budget ---
    await db.runTransaction(async (tx) => {
      const [userSnap, spendSnap] = await Promise.all([tx.get(userRef), tx.get(spendRef)]);

      const u = userSnap.exists ? userSnap.data() : {};
      const used = u.date === day ? (u.count || 0) : 0;
      if (used >= USER_DAILY[tier]) {
        throw new HttpsError(
          "resource-exhausted",
          tier === "staff" ? "STAFF_USER_LIMIT" : "USER_LIMIT"
        );
      }

      const sp = spendSnap.exists ? spendSnap.data() : {};
      const spent = sp[`${tier}_sek`] || 0;
      if (spent >= MONTHLY_BUDGET_SEK[tier]) {
        throw new HttpsError(
          "resource-exhausted",
          tier === "staff" ? "BUDGET_EXHAUSTED_STAFF" : "BUDGET_EXHAUSTED_ANON"
        );
      }

      tx.set(userRef, { date: day, count: used + 1 });
    });

    // --- Fan out to all models, streaming each result as it lands ---
    const apiKey = GEMINI_API_KEY.value();
    const drafts = [];
    const errors = [];
    let totalCostSek = 0;
    const emit = (obj) => {
      if (response && typeof response.sendChunk === "function") response.sendChunk(obj);
    };

    await Promise.allSettled(
      ALL_MODELS.map(async (modelName) => {
        try {
          const { board, usage } = await generateWithModel(modelName, systemPrompt, userText, apiKey);
          totalCostSek += computeCostSek(modelName, usage);
          const draft = {
            board,
            info: {
              id: MODELS[modelName].label,
              model: modelName,
              style: MODELS[modelName].style,
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

    // --- Accrue actual cost to the shared monthly bucket (atomic increment) ---
    if (totalCostSek > 0) {
      try {
        await spendRef.set(
          { month, [`${tier}_sek`]: FieldValue.increment(totalCostSek) },
          { merge: true }
        );
      } catch (e) {
        console.warn("Failed to record spend:", e?.message || e);
      }
    }

    if (drafts.length === 0) {
      throw new HttpsError(
        "internal",
        "Alla AI-anrop misslyckades. " + errors.map((e) => `${e.model}: ${e.message}`).join(" | ")
      );
    }

    return { tier, drafts, errors, costSek: totalCostSek };
  }
);
