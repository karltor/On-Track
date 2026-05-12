# On-Track
Inspirerat av På Spåret - Var är vi påväg? Men som gamification för klassrum.

## AI-generering (Cloud Function-proxy)

AI-brädesgenereringen går via en Firebase Cloud Function (`functions/index.js`,
callable `generateBoard`, region `europe-west1`). Funktionen håller Gemini-API-nyckeln
(klienten ser den aldrig) **och själva system-prompten** – klienten kan bara välja ämne
(`create`) eller skicka in brädet + ändringsinstruktion (`edit`), aldrig hela
instruktionen, så proxyn inte kan kapas till en gratis-LLM. Anropen kräver dessutom
**Firebase App Check** (steg 3b nedan). Funktionen bokför dagsanvändning per användare,
delad månadskostnad per användartyp, och en hård global dagsbudget i SEK:

**Modeller (samma lista för alla användare)** — fyra snabba Gemini Flash-varianter racas
parallellt, första svar visas direkt: `gemini-3-flash-preview`, `gemini-3.1-flash-lite`,
`gemini-3.1-flash-lite-preview`, `gemini-2.5-flash-lite`.

**Kvoter:**

- **Dagstak per användare** (`USER_DAILY` i `functions/index.js`): 50/dygn för gäster,
  500/dygn för inloggade lärare. Säkerhetsspärr så ingen enskild användare kan tömma
  månadsbudgeten på fem minuter.
- **Delad månadsbudget i SEK** (`MONTHLY_BUDGET_SEK`): 30 kr/månad totalt för gäster,
  50 kr/månad totalt för lärare. Räknas mot UTC-månad i `ai_spend/{YYYY-MM}`.
- **Hård global dagsbudget i SEK** (`DAILY_BUDGET_SEK`): 10 kr/dygn totalt för alla
  användare och tier:ar tillsammans. Räknas mot UTC-dygn i `ai_global/{YYYY-MM-DD}`.
  Sista spärren – tillsammans med App Check – mot att någon kringgår per-användare-taket
  genom att skapa hur många anonyma konton som helst. Slut → `DAILY_BUDGET_EXHAUSTED`.
- **Pris-tabell** (`PRICING_USD_PER_M`): USD per 1 M tokens per modell. Kontrollera mot
  <https://ai.google.dev/gemini-api/docs/pricing#standard> och uppdatera om Google ändrar
  priserna. `SEK_PER_USD` = 10.5 (justera vid större valutaändring).
- **Inloggad lärare** = `@nyamunken.se`-konto utan tre siffror i rad i prefixet. Räknas
  mot lärarbudgeten i stället för gäst-budgeten.

När månadsbudgeten är slut returnerar funktionen `BUDGET_EXHAUSTED_ANON` /
`_STAFF` → klienten öppnar en dialog som hänvisar till **"Klistra in JSON"**-vägen
(generera via valfri chattbot och importera resultatet).

### Steg-för-steg: så här deployar du (för nybörjare)

Allt görs i en terminal, i den här mappen (`On-Track/`).

**0. Förkrav (engångsgrej)**

- Installera Node.js (LTS): https://nodejs.org/ — testa med `node --version` (ska vara 20+).
- Installera Firebase CLI:
  ```sh
  npm install -g firebase-tools
  ```
- Logga in på ditt Google-konto (det som äger Firebase-projektet `on-track-d77d0`):
  ```sh
  firebase login
  ```
- **Viktigt:** Cloud Functions kräver att Firebase-projektet ligger på *Blaze*-planen
  (pay-as-you-go). I praktiken är det gratis vid den här trafiken, men du måste lägga
  in ett kort. Gör det i Firebase Console → ⚙️ → Usage and billing → Modify plan → Blaze.
  Första `firebase deploy` aktiverar också automatiskt API:erna Cloud Functions, Cloud
  Build, Artifact Registry och Secret Manager (säg ja om den frågar).

**1. Var är min nuvarande API-nyckel?**

Den ligger idag i Firestore: Firebase Console → Build → Firestore Database → samlingen
`secrets`, dokumentet `gemini`, fältet `key`. Kopiera det värdet. (Vill du hellre ha en
helt ny nyckel: skapa en på https://aistudio.google.com/apikey.)

**2. Installera funktionens beroenden**

```sh
cd functions
npm install
cd ..
```

**3. Lägg nyckeln som en hemlighet i Google Cloud (Secret Manager)**

```sh
firebase functions:secrets:set GEMINI_API_KEY
```
Klistra in API-nyckeln när den frågar och tryck Enter. (Nyckeln hamnar i Google Cloud
Secret Manager och skrivs ALDRIG i koden eller i repot.)

**3b. Sätt upp Firebase App Check (reCAPTCHA v3)**

Funktionen är deployad med `enforceAppCheck: true`. Gör DETTA INNAN du deployar i steg 4,
annars avvisas alla AI-anrop:

1. Skapa en reCAPTCHA **v3**-nyckel på <https://www.google.com/recaptcha/admin/create>
   (välj "Score based (v3)", lägg till domänen där appen körs, t.ex. `karltor.github.io`
   och `localhost`). Kopiera **site key** (den publika nyckeln) och **secret key**.
2. Firebase Console → ⚙️ → **App Check** → fliken **Apps** → välj din webb-app →
   **reCAPTCHA v3** → klistra in *secret key* → Spara.
3. Öppna `admin.js` och byt ut `RECAPTCHA_V3_SITE_KEY_HERE` mot din *site key*.
4. (Valfritt men rekommenderat) I App Check, sätt **Enforcement** på *Cloud Functions*
   till "Enforced".

För lokala emulator-tester: kör i webbläsarkonsolen `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`
innan sidan laddar, kopiera debug-token ur konsolen och registrera den i App Check →
Manage debug tokens. (Functions-emulatorn struntar oftast i App Check, men ID-token-flödet
behöver fungera.)

**4. Deploya funktionen + de uppdaterade Firestore-reglerna**

```sh
firebase deploy --only functions,firestore:rules
```
Det tar någon minut. När det står "Deploy complete!" är AI-proxyn live. (Första gången
aktiveras även Firebase App Check API automatiskt – säg ja.)

**5. Testa**

Öppna appen. Utan att logga in: klicka "✨ Generera med AI" → du ska kunna generera som
gäst (max 50/dag). Klicka "💼 Nya Munken-personal: logga in" → efter
inloggning med din `@nyamunken.se`-adress får du även Gemini-modellerna (stjärnmärkta).

**6. Städa upp (valfritt)**

När allt funkar kan du ta bort det gamla `secrets/gemini`-dokumentet i Firestore — det
går ändå inte längre att läsa från klienten (`firestore.rules` blockerar det nu).

> Att pusha till GitHub uppdaterar bara hemsidan (GitHub Pages). Cloud Function:en
> deployas inte automatiskt — du måste köra `firebase deploy --only functions,firestore:rules`
> manuellt (t.ex. i Google Cloud Shell) varje gång `functions/` eller `firestore.rules` ändras.

Firestore-collections som funktionen använder: `ai_usage/{uid}` (per-användare/dag),
`ai_spend/{YYYY-MM}` (delade månadskostnader i SEK) och `ai_global/{YYYY-MM-DD}`
(global dygnskostnad i SEK). Klienter kan varken läsa eller skriva dessa (se
`firestore.rules`).

Vill du följa förbrukningen i loggarna: `firebase functions:log --only generateBoard`
(eller Google Cloud Console → Logging). Varje anrop loggar en `[generateBoard] …`-rad
med användarens dagsräknare samt månads- och dygnskostnad.
