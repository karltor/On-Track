# On-Track
Inspirerat av På Spåret - Var är vi påväg? Men som gamification för klassrum.

## AI-generering (Cloud Function-proxy)

AI-brädesgenereringen går via en Firebase Cloud Function (`functions/index.js`,
callable `generateBoard`, region `europe-west1`). Funktionen håller Gemini/Gemma
API-nyckeln, så klienten ser den aldrig, och den enforcar dagsgränser:

- Gäst (anonym Firestore-auth): max **50** genereringar/dag per användare, endast
  Gemma-modeller (Gemma 3 27B/12B + Gemma 4 31B/26B).
- Globala gäst-tak per dygn (UTC): **10 000** Gemma 3-anrop, **1 000** Gemma 4 26B-anrop,
  **5 000** Gemma 4 31B-anrop. Tak per modell justeras i `GLOBAL_CAPS` i `functions/index.js`.
- Inloggad Nya Munken-personal (`@nyamunken.se`): premium-AI (även Gemini-modellerna),
  hög skyddsgräns på **500**/dag, räknas inte mot gäst-taken.

> Obs: de exakta API-id:na för "Gemma 4 31B/26B" är platshållare i `functions/index.js`
> (`GEMMA4_31B` / `GEMMA4_26B`). Uppdatera dem till riktiga `models/...`-id när de
> bekräftats. Felaktigt id => modellen 404:ar och hoppas tyst över i racet.

### Deploy

```sh
# 1. Installera beroenden
cd functions && npm install && cd ..

# 2. Lägg in API-nyckeln som Cloud Function-hemlighet (skrivs ALDRIG i repot)
firebase functions:secrets:set GEMINI_API_KEY
# klistra in nyckeln när den efterfrågas

# 3. Deploya funktion + Firestore-regler
firebase deploy --only functions,firestore:rules
```

Lokalt: `firebase emulators:start --only functions,firestore,auth`.

Firestore-collections som funktionen använder: `ai_usage/{uid}` (per-användare/dag)
och `ai_global/{YYYY-MM-DD}` (globala räknare). Klienter kan inte skriva till dem
(se `firestore.rules`).
