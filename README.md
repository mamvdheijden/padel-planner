# Padel Planner

Kleine app om padel-avonden te plannen met je groep. Spelers tikken de dagen aan waarop ze kunnen; bij genoeg spelers doet de app een voorstel dat de organisator accepteert. De app boekt niets zelf.

- **Spelers:** alleen via hun persoonlijke link (`https://jouw-domein/p/naam-code`). Zonder link ziet een bezoeker niets en kan hij niet stemmen.
- **Organisator:** `https://jouw-domein/admin` (met pincode)
- **Per speler:** de dagen waarop hij kan, of het vinkje "Ik kan geen enkele datum" (dan telt hij als gestemd), en een voorkeurstijd (standaard 20:30 of 21:00, of "maakt niet uit"). De organisator ziet de voorkeurstijden bij het voorstel. De tijden zijn aan te passen onder "Nieuwe ronde starten".
- **Meerdere rondes:** je kunt er meerdere tegelijk open hebben (bijvoorbeeld voor verschillende groepen of periodes), met een eigen naam, startdatum en instellingen. Spelers komen eerst op een overzicht en kiezen daar een ronde. Een ronde die voorbij is, gaat vanzelf naar het archief.
- **Data:** worden elke keer uit de kalender berekend: de eerstvolgende maandag (of de maandag op of na een gekozen startdatum), het ingestelde aantal weken, alleen de gekozen dagen (standaard ma t/m do) en zonder Nederlandse feestdagen. Is er geen ronde meer over omdat de laatste verlopen is, dan start er vanzelf een nieuwe.
- **Techniek:** Node.js zonder externe packages, gegevens in één bestand (`/data/db.json`).

## Op TrueNAS zetten (via GitHub)

Bij elke push naar `main` bouwt GitHub Actions automatisch de image `ghcr.io/mamvdheijden/padel-planner:latest`.

### Eenmalig

1. Wacht tot de workflow **Build image** onder het tabblad *Actions* groen is.
2. Maak de image toegankelijk voor TrueNAS. Kies één van deze twee:
   - **Makkelijkst:** GitHub → je profiel → *Packages* → `padel-planner` → *Package settings* → zet *Visibility* op **Public**. De code in de repo blijft privé; alleen de image is dan te downloaden.
   - **Privé houden:** maak een token (*classic*) met alleen `read:packages` en vul bij het aanmaken van de app in TrueNAS (*Image credentials*) registry `ghcr.io`, je GitHub-naam en dat token in.
3. Maak in TrueNAS een dataset voor de data, bijvoorbeeld `apps/padel-planner`.
4. **Apps → Discover Apps → Custom App → Install via YAML** en plak dit (pas `POOL` en de pincode aan):

```yaml
services:
  padel-planner:
    image: ghcr.io/mamvdheijden/padel-planner:latest
    restart: unless-stopped
    environment:
      TZ: Europe/Amsterdam
      ADMIN_PIN: "kies-een-pincode"
    ports:
      - "3000:3000"
    volumes:
      - /mnt/POOL/apps/padel-planner:/data
```

5. Test op `http://<truenas-ip>:3000`.

### Bijwerken

Wijziging pushen naar GitHub, wachten tot de workflow klaar is, en in TrueNAS bij de app op **Update** (of stoppen en opnieuw starten, dan haalt hij de nieuwste image op).

## Openbaar maken met Cloudflare

1. Cloudflare Zero Trust → **Networks → Tunnels** → tunnel maken (of een bestaande gebruiken).
2. **Public hostname** toevoegen: bijvoorbeeld `padel.jouwdomein.nl` met service `HTTP` en `<truenas-ip>:3000`.
3. Aanrader: zet in Cloudflare Access een extra regel op `padel.jouwdomein.nl/admin` (bijvoorbeeld alleen jouw e-mailadres). Dan zit er een tweede slot op het beheer, bovenop de pincode.

## Lokaal draaien

```
ADMIN_PIN=1234 TZ=Europe/Amsterdam node server.js
```

Daarna op `http://localhost:3000` (spelers) en `/admin` (organisator).

## Goed om te weten

- **Persoonlijke links:** onder "Spelers beheren" in `/admin` voeg je spelers toe en kopieer of verstuur je hun link. De link werkt op elk apparaat en wordt onthouden, dus later terugkomen via `/` werkt ook op dat apparaat. Verwijder je een speler, dan vervalt zijn link.
- **Toegang:** de gegevens zijn alleen op te vragen met een geldige link-code of de beheerpincode. Wie een link doorstuurt, geeft toegang als die speler. Verwijder een speler om zijn link ongeldig te maken.
- **Pincode:** na 10 foute pogingen is er 10 minuten pauze. Kies geen pincode die je elders gebruikt.
- **Back-up:** kopieer `db.json` uit de data-map af en toe. Dat is alles wat de app bewaart.
- **Instellingen** (weken, dagen, aantal spelers, club, feestdagen) pas je aan onder "Nieuwe ronde starten" in `/admin`. Ze worden onthouden voor de volgende rondes.
