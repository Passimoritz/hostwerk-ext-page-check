![Page check](banner.svg)

# Page check

Checks pages of your web projects: load time, size, compression, SEO basics (title, description, headings), accessibility basics (language, image texts, labels) and broken links on the same site – with a score, concrete tips and history.

[Deutsch](README.de.md) · An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension (SDK 2.7, native extension)

![Screenshot](docs/screenshot.png)

## What it does

- Load time (first byte and total), page size and compression
- SEO basics: title, description, one main heading, canonical link, social preview
- Accessibility basics: page language, image texts, form labels, link texts
- Broken links and images on the same site (up to 40 per check)
- Score per area with plain tips, history per address

## Install

In Hostwerk: **Extensions → Discover** and click “Install”.

Native extensions run as part of Hostwerk (own server and interface part). That is why Hostwerk only installs them from the official catalogue (with checksum) or in developer mode.

## Data

`data/page-check` – the last 30 results per address. Removing the extension keeps them.

## Develop

```bash
node --test tests/*.test.js          # tests
node build-native.js .               # build the interface (sdk/build-native.js from hostwerk-public)
node check.js . --strict             # same check as the catalogue (sdk/check.js)
```

Interface source in `ui/src`, server part in `server/`. Texts in the code are English, German is in `locales/de.json`.

## License

MIT
