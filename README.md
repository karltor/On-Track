# On-Track
Inspirerat av På Spåret - Var är vi påväg? Men som gamification för klassrum.

## AI-generering (Cloud Function-proxy)

AI-brädesgenereringen går via en Firebase Cloud Function (`functions/index.js`,
callable `generateBoard`, region `europe-west1`). Funktionen håller Gemini/Gemma
API-nyckeln, så klienten ser den aldrig, och den enforcar dagsgränser:

- Gäst (anonym Firestore-auth): max **50** genereringar/dag per användare. Modeller som
  racas: Gemini 3.1 Flash Lite, Gemini 2.5 Flash Lite, Gemini 2.0 Flash Lite, Gemini 2.0
  Flash (alla snabba), plus Gemma 4 31B & 26B som långsamma bonus-alternativ (avbryts av
  per-anrops-timeouten om de inte hinner klart). Varje gäst har dessutom en egen
  dygnskvot per modell (`ANON_MODEL_PER_USER` i `functions/index.js`, t.ex. 10/dag för
  3.1 Flash Lite).
- Globala gäst-tak per dygn (UTC) i `GLOBAL_CAPS`: 300 (3.1 Flash Lite), 700 (2.5 Flash
  Lite), 1200 (2.0 Flash Lite), 150 (2.0 Flash), 5000/1000 (Gemma 4 31B/26B). Tunas så de
  håller sig under API-nyckelns gratiskvot.
- Inloggad Nya Munken-personal (`@nyamunken.se`): full premium-AI — även Gemini 3 Flash
  och Gemini 2.5 Flash, inga per-modell-kvoter, hög skyddsgräns på **500**/dag, räknas
  inte mot gäst-taken.

> Obs: Gemma 3 (`gemma-3-*-it`) finns inte längre på Gemini-API:t — kvar är bara Gemma 4.
> Vilka modeller en nyckel har tillgång till syns via `.../v1beta/models`-endpointen.
> Ett felaktigt modell-id => 404 och modellen hoppas tyst över i racet.

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
