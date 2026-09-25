# SecondBarrel — site/

Statisk v2: `index.html` (listen) + `vaaben/<detail_id>.html` (én rigtig,
selvstændig HTML-fil pr. våben, ikke en fælles skabelon), `styles.css`,
`app.js`, `detail.js`, drevet af `data.json` + `details/*.json`.

`vaaben/<id>.html` er selv statisk (unik titel/meta-beskrivelse/JSON-LD,
synlig tekst allerede i den raa HTML - for crawlere og AI-søgning, se
CLAUDE.md), men `detail.js` loader stadig og "genrenderer" samme indhold på
klienten for at wire galleriets piletaster/klik + favorit-stjernen op -
harmløst dobbeltarbejde, ikke en fejl.

## Kør lokalt

```
cd site
python -m http.server 8000
```

Åbn derefter <http://localhost:8000/>. Siden henter `data.json` med `fetch()`,
hvilket kræver `http://` — den virker ikke ved at dobbeltklikke filen op som
`file://`.

## Data

`data.json`, `details/<detail_id>.json`, `vaaben/<detail_id>.html`,
`sitemap.xml`, `robots.txt` og `llms.txt` genereres ALLE af
`python export_data.py` i projektroden (ud fra `gg_vaaben.db` og
`vaaben_template.html` i projektroden), i den rækkefølge:

1. `gg_vaaben_scraper.py --reparse` / `--fetch-images` og
   `forhandler_scraper.py --details` / `--fetch-images` (opdaterer databasen)
2. `python export_data.py` (skriver `data.json` + `details/` + `vaaben/` +
   sitemap/robots/llms.txt, kopierer billeder ind under `site/images/` og
   `site/thumbs/`)
3. Genindlæs siden

Rør ikke `data.json`, `details/` eller `vaaben/` manuelt her i `site/` — kør
scriptet igen i stedet. `export_data.py` rydder og genskriver `details/` og
`vaaben/` fra bunden ved hvert kald, så der aldrig ligger en fil for et
våben, der ikke længere findes i `all_weapons`.

**SITE_BASE_URL** (i `export_data.py`) skal rettes til den rigtige,
registrerede domæneadresse, før canonical-links/sitemap/JSON-LD giver mening
i produktion — peger indtil da på `https://secondbarrel.com`, som endnu ikke
er registreret.

## Sider

- `index.html` — listen med filtre. Klik på et billede åbner
  `vaaben/<detail_id>.html` for det våben; resten af kortet linker som før
  direkte til kilden. Filterbjælken har også "Nær postnummer" + "Radius" og
  en "Afstand: nærmest først"-sortering (se `postnumre.json` nedenfor) — kun
  private annoncer har et postnummer, så radius-filteret lader altid
  forhandlere stå, uanset afstand.
- `vaaben/<detail_id>.html` — underside pr. våben: billedgalleri, sælgers
  beskrivelse (hvis den findes) og en knap til kilden. `detail_id` er den
  samme værdi, som står i hvert items `detail_id`-felt i `data.json`. Er en
  RIGTIG, selvstændig HTML-fil (ikke en delt skabelon) med unik
  titel/meta-beskrivelse/JSON-LD allerede i den raa HTML.

`postnumre.json` genereres også af `export_data.py` (fra `postnumre_dk.json`
i projektroden) og bruges kun til at slå et BRUGERINDTASTET postnummer op —
findes filen ikke, er radius-feltet bare permanent deaktiveret.
