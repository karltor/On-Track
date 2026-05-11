# On-Track
Inspirerat av På Spåret - Var är vi påväg? Men som gamification för klassrum.

## AI-generering (Cloud Function-proxy)

AI-brädesgenereringen går via en Firebase Cloud Function (`functions/index.js`,
callable `generateBoard`, region `europe-west1`). Funktionen håller Gemini-API-nyckeln,
så klienten ser den aldrig, och bokför både dagsanvändning per användare och delad
månadskostnad per användartyp:

**Modeller (samma lista för alla användare)** — fem snabba Gemini Flash-varianter racas
parallellt, första svar visas direkt: `gemini-3-flash-preview`, `gemini-3.1-flash-lite`,
`gemini-3.1-flash-lite-preview`, `gemini-2.5-flash-lite`,
`gemini-2.5-flash-lite-preview-09-2025`.

**Kvoter:**

- **Dagstak per användare** (`USER_DAILY` i `functions/index.js`): 50/dygn för gäster,
  500/dygn för inloggade lärare. Säkerhetsspärr så ingen enskild användare kan tömma
  månadsbudgeten på fem minuter.
- **Delad månadsbudget i SEK** (`MONTHLY_BUDGET_SEK`): 30 kr/månad totalt för gäster,
  50 kr/månad totalt för lärare. Räknas mot UTC-månad i `ai_spend/{YYYY-MM}`.
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

**4. Deploya funktionen + de uppdaterade Firestore-reglerna**

```sh
firebase deploy --only functions,firestore:rules
```
Det tar någon minut. När det står "Deploy complete!" är AI-proxyn live.

**5. Testa**

Öppna appen. Utan att logga in: klicka "✨ Generera med AI" → du ska kunna generera som
gäst (max 50/dag). Klicka "💼 Nya Munken-personal: logga in" → efter
inloggning med din `@nyamunken.se`-adress får du även Gemini-modellerna (stjärnmärkta).

**6. Städa upp (valfritt)**

När allt funkar kan du ta bort det gamla `secrets/gemini`-dokumentet i Firestore — det
går ändå inte längre att läsa från klienten (`firestore.rules` blockerar det nu).

### Automatisk deploy av funktionen (GitHub Actions)

Att pusha till GitHub uppdaterar bara hemsidan (GitHub Pages). Cloud Function:en
deployas inte automatiskt — om inte du sätter upp detta engångssteg:

1. I Cloud Shell (eller var som helst med Firebase CLI): kör `firebase login:ci`
   och kopiera token-strängen den skriver ut.
2. På GitHub: repo → **Settings → Secrets and variables → Actions → New repository
   secret**. Namn: `FIREBASE_TOKEN`, värde: token-strängen.

Klart. Workflowen `.github/workflows/deploy-functions.yml` kör då
`firebase deploy --only functions,firestore:rules` automatiskt vid varje push till
`main` som rör `functions/` eller `firestore.rules`. Du kan också trigga den manuellt
under fliken **Actions → Deploy Cloud Functions → Run workflow**.

Firestore-collections som funktionen använder: `ai_usage/{uid}` (per-användare/dag)
och `ai_global/{YYYY-MM-DD}` (globala räknare). Klienter kan inte skriva till dem
(se `firestore.rules`).
