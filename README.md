# RechtUndOrdnung - DSGVO Surveillance Reporting Platform

Minimalistische API-First Platform zum Melden rechtswidriger Videoüberwachung.

## 🎯 Features

- ✅ **API-First Architektur** - REST API mit Express
- ✅ **JWT Authentication** - Sichere Benutzer-Authentifizierung
- ✅ **Photo Upload mit EXIF** - Automatische GPS-Extraktion
- ✅ **50m Proximity Check** - MySQL Spatial Query warnt bei nahen Anzeigen
- ✅ **Aktenzeichen-E-Mail-System** - Jede Anzeige bekommt eigene Adresse
- ✅ **Minimalistisch** - Nur 8 Dateien!
- ✅ **Bootstrap UI** - Mobile-First Responsive Design

## 📁 Dateistruktur

```
ruo-platform/
├── docker-compose.yml      # MySQL + Node Container
├── schema.sql              # Datenbank-Schema
├── package.json            # Dependencies
├── server.js               # API Server (ALLES in einer Datei!)
├── .env.example            # Konfiguration
└── public/                 # Frontend (4 HTML-Dateien)
    ├── index.html          # Login/Register
    ├── dashboard.html      # Übersicht
    ├── create.html         # Anzeige erstellen
    └── detail.html         # Anzeige Details
```

**Nur 8 Dateien total!**

## 🚀 Installation

### 1. .env Datei erstellen

```bash
cp .env.example .env
```

Dann `.env` bearbeiten und SMTP/IMAP Zugangsdaten eintragen:

```env
SMTP_HOST=mail.treudler.net
SMTP_PORT=587
SMTP_USER=posteingang@rechtundordnung.treudler.net
SMTP_PASS=your_password
```

### 2. Mit Docker Compose starten

```bash
# Container starten (MySQL + Node.js App)
docker-compose up -d

# Logs ansehen
docker-compose logs -f app

# Status prüfen
docker-compose ps
```

### 3. Browser öffnen

```
http://localhost:3000
```

## 📝 Verwendung

### 1. **Registrieren**
- Öffne `http://localhost:3000`
- Klicke auf "Registrieren"
- Gib E-Mail und Passwort ein

### 2. **Anzeige erstellen**
- Klicke auf "+ Neue Anzeige"
- Schritt 1: Bericht erstellen (generiert Aktenzeichen)
- Schritt 2: Fotos hochladen (EXIF GPS wird automatisch extrahiert)
  - ⚠️ Bei Fotos mit GPS: Proximity Check warnt bei Anzeigen im 50m-Umkreis
- Schritt 3: Verstoß auswählen, Hinweise angeben, "Absenden"

### 3. **E-Mail-Versand**
- System sendet E-Mail von `aktenzeichen@rechtundordnung.treudler.net`
- Fotos als Anhang
- Antworten landen im IMAP Posteingang (catchall)

## 🔧 API Endpoints

### Public
- `GET /api/health` - Health Check
- `GET /api/public/reports` - Öffentliche Anzeigen

### Auth
- `POST /api/register` - Registrierung
- `POST /api/login` - Login
- `GET /api/me` - Aktueller Benutzer (JWT required)

### Reports (JWT required)
- `POST /api/reports` - Neue Anzeige erstellen
- `GET /api/reports` - Eigene Anzeigen
- `GET /api/reports/:id` - Anzeige Details
- `PUT /api/reports/:id` - Anzeige bearbeiten
- `DELETE /api/reports/:id` - Anzeige löschen (nur draft)
- `POST /api/reports/:id/submit` - Anzeige absenden (verschickt E-Mail)

### Photos (JWT required)
- `POST /api/photos` - Foto hochladen (multipart/form-data)
  - Body: `photo` (file), `reportId` (int)
  - Response: Proximity Warning wenn andere Anzeigen im 50m-Umkreis

## 🛠️ Development

### Ohne Docker

```bash
# Dependencies installieren
npm install

# MySQL muss laufen (Port 3306)
# schema.sql manuell importieren

# Server starten
npm start

# Dev-Modus mit Auto-Reload
npm run dev
```

### Mit Docker

```bash
# Logs live ansehen
docker-compose logs -f app

# Container neu starten
docker-compose restart app

# In Container Shell öffnen
docker-compose exec app sh

# Datenbank zurücksetzen
docker-compose down -v
docker-compose up -d
```

## 📊 Datenbank

### Tabellen
- `users` - Benutzer
- `reports` - Anzeigen
- `photos` - Fotos mit GPS
- `documents` - Hochgeladene Dokumente
- `email_logs` - E-Mail-Verlauf
- `status_history` - Status-Änderungen

### Spatial Index
Für 50m Proximity Check nutzen wir MySQL Spatial Functions:
```sql
SELECT id, case_number,
       ST_Distance_Sphere(
         POINT(location_lng, location_lat),
         POINT(?, ?)
       ) as distance
FROM reports
HAVING distance <= 50
```

## 🔐 Sicherheit

- Passwörter mit bcrypt (10 rounds)
- JWT mit 7 Tage Gültigkeit
- SQL Injection Prevention (Prepared Statements)
- CORS aktiviert
- File-Upload Validierung

## 📧 E-Mail-System

### Aktenzeichen-Adressen
Jede Anzeige bekommt eigene E-Mail-Adresse:
- Aktenzeichen: `RUO-2511-0042`
- E-Mail: `ruo-2511-0042@rechtundordnung.treudler.net`

### SMTP-Versand
```javascript
from: "ruo-2511-0042@rechtundordnung.treudler.net"
to: "ordnungsamt@example.com"
replyTo: "ruo-2511-0042@rechtundordnung.treudler.net"
attachments: [photo1.jpg, photo2.jpg, ...]
```

### IMAP Catchall (TODO)
Alle Antworten landen bei `posteingang@rechtundordnung.treudler.net`.
Parser extrahiert Aktenzeichen aus "To"-Adresse und ordnet E-Mail automatisch zu.

## 🚧 TODO

- [ ] IMAP Polling für eingehende E-Mails
- [ ] weg.li API Integration für automatische Ordnungsamt-Zuordnung
- [ ] Geocoding (Nominatim) für Adressauflösung
- [ ] PDF-Generierung für E-Mail-Anhang
- [ ] Status-Management durch Benutzer
- [ ] Dokumenten-Upload nach Versand
- [ ] Public Reports Seite

## 🐛 Troubleshooting

### Port 3000 bereits belegt
```bash
# Anderen Port verwenden
docker-compose down
# In docker-compose.yml ändern: "3001:3000"
docker-compose up -d
```

### MySQL Connection Error
```bash
# Warte bis MySQL bereit ist
docker-compose logs mysql

# Sollte sehen: "ready for connections"
```

### SMTP Error beim Absenden
- `.env` Datei prüfen
- SMTP Credentials korrekt?
- Port 587 erreichbar?

## 📄 Lizenz

MIT

## 👨‍💻 Author

Entwickelt mit Node.js + Express in minimalistischem Stil.
