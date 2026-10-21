![Seiten-Check](banner.svg)

# Seiten-Check

Prüft Seiten deiner Web-Projekte – einzeln oder die ganze Website: Geschwindigkeit, SEO, Barrierefreiheit, Sicherheits-Kopfzeilen und kaputte Links – mit Punktzahl, konkreten Tipps, Verlauf, regelmäßiger Prüfung und Mindestpunktzahl vor dem Veröffentlichen.

[English](README.md) · Eine offizielle [Hostwerk](https://github.com/Passimoritz/hostwerk-public) Erweiterung (SDK 2.7, native Erweiterung)

![Screenshot](docs/screenshot.de.png)

## Was sie kann

- Ladezeit (erstes Byte und gesamt), Seitengröße und Komprimierung
- SEO: Titel, Beschreibung, eine Hauptüberschrift, Canonical-Link, Vorschau für soziale Netze, robots.txt (und ob sie Suchmaschinen aussperrt), sitemap.xml
- Barrierefreiheit-Grundlagen: Seitensprache, Bildtexte, Beschriftungen von Feldern, Linktexte, Reihenfolge der Überschriften (zuerst h1, keine Stufe übersprungen)
- Sicherheits-Kopfzeilen: HTTPS (außer bei lokalen Testadressen), HSTS, Content Security Policy, X-Content-Type-Options, Referrer-Policy, Schutz vor Einbetten
- Kaputte Links und Bilder auf derselben Seite (bis zu 40 je Seite)
- **Ganze Website**: folgt den Links der Website bis zu N Seiten (Startseite mitgezählt, höchstens 100) – eine Zeile je Seite, die schlechteste zuerst, jeder Link und jedes Bild einmal geprüft
- Punkte je Bereich mit verständlichen Tipps, Verlauf je Adresse
- **Regelmäßige Prüfung** (täglich oder wöchentlich) – fällt die Punktzahl um 5 oder mehr, kommt eine Meldung, dazu ein Eintrag unter Livebetrieb → Wächter
- **Mindestpunktzahl vor dem Veröffentlichen**: andere Erweiterungen rufen `host.use('pageCheck').gate(url)` auf und halten unter der Punktzahl an (z. B. „Seiten veröffentlichen“)
- Reiter auf jedem Projekt und im Webserver-Bereich; steht unter „Entwickeln“ direkt hinter den Projekten; ein Tastenkürzel „Seite prüfen“ lässt sich unter Einstellungen → Allgemein → Tastenkürzel belegen

## Für andere Erweiterungen

```js
const pc = await host.use('pageCheck');
const g = await pc.gate('http://shop.localhost/');   // { ok, score, min, text } – min aus den Einstellungen, oder gate(url, { min: 80 })
const r = await pc.check('http://shop.localhost/');  // volles Ergebnis, landet auch im Verlauf
```

## Installieren

In Hostwerk: **Erweiterungen → Entdecken** und „Installieren“ klicken.

Native Erweiterungen laufen als Teil von Hostwerk (eigener Server- und Oberflächen-Teil). Deshalb installiert Hostwerk sie nur aus dem offiziellen Katalog (mit Prüfsumme) oder im Entwickler-Modus.

## Daten

`data/page-check` – die letzten 30 Ergebnisse je Adresse, die letzten 10 Website-Prüfungen und die Einstellungen (regelmäßige Prüfungen, Mindestpunktzahl). Beim Entfernen der Erweiterung bleiben sie erhalten.

## Entwickeln

```bash
node --test tests/*.test.js          # Tests
node build-native.js .               # Oberfläche bauen (sdk/build-native.js aus hostwerk-public)
node check.js . --strict             # dieselbe Prüfung wie der Katalog (sdk/check.js)
```

Oberfläche in `ui/src`, Server-Teil in `server/`. Texte im Code sind Englisch, Deutsch steht in `locales/de.json`.

## Lizenz

MIT
