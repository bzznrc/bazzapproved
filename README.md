# My collection

A static personal collection for GitHub Pages. The original paper background, serif headings, navigation, and cover grid are preserved. No build step, dependencies, API keys, or backend are required.

## Publish

Extract the ZIP and copy its **contents** into your existing GitHub Pages publishing folder. Keep `index.html`, `css/`, `js/`, and `data/` together. All application paths are relative, so both a repository site (`username.github.io/repository/`) and a custom domain work.

For branch-based GitHub Pages, publish that folder from your chosen branch in the repository's **Settings → Pages**. The included `.nojekyll` file serves the files directly. Your existing domain and repository settings do not need to change.

For local preview, use VS Code Live Server or run `python3 -m http.server 8000` in this folder, then visit `http://localhost:8000`. Opening `index.html` directly as a `file:` URL cannot load the JSON files.

## What's changed

- Consistent 8px cover corners, restrained shadows, aligned card typography, and responsive spacing.
- Collections use a visible fan of two or three covers and a permanent “Collection · N items” action with a layers icon and opening arrow. Hovering or focusing the card spreads the fan and lifts the front cover. Opening a collection reveals the dialog and its members with a short stagger. Touch devices get press feedback, and reduced-motion preferences are respected. Single-member collections still appear as ordinary cards.
- All artwork uses a centered crop that fills its tile without stretching or letterboxing, including artwork inside collections. Edges may be cropped to fit the tile's proportions.
- Fable is the original Xbox release from 2004, with its original box artwork.
- Bits use intentional text covers containing **only the title**. The linked full title and creator/year remain underneath. No preview-image proxy is needed.
- Every existing game has a Steam artwork ID or an explicit cover URL. Game artwork starts loading immediately; it no longer depends on a missing image triggering an error or on a cross-origin Store Search request. Newer Steam artwork with hashed URLs uses its exact URL.
- Optional note icons sit **beside the byline**, below the artwork. Notes open in a small read-only dialog with preserved paragraphs, wrapping, scrolling, Escape/close controls, and focus restoration. Notes also work inside an open collection.
- Removed unused short titles, original movie titles, repeated types, empty notes, generated proxy URLs, and duplicated movie image/IMDb fields. The files preserve all 62 books, 127 movies/series, 37 games, and 25 bits, in their original order.

## Data format

Each file in `data/` is one flat JSON array. The filename determines its category, so entries do not need `type`.

| Field | Meaning |
| --- | --- |
| `id` | Required, unique string within its file. For movies/series, use the IMDb ID here. |
| `title` | Required, full display title. |
| `creator` | Optional author, director, developer, or credited creator. The same field is used throughout. |
| `year` | Optional integer year. All supplied entries have one. Fable is corrected to the original Xbox release year, 2004. |
| `isbn` | Books: ISBN string used to fetch the cover. |
| `steamId` | Games: numeric Steam app ID for standard library artwork. |
| `image` | Optional explicit artwork URL or relative local image path. Takes precedence over derived artwork. Useful for console games and hashed Steam artwork. |
| `link` | Optional destination URL. Bits link their title; other cards show an “Open link” label. |
| `note` | Optional plain-text personal note. Omit it until you have something to say. |
| `collectionId` | Optional shared ID grouping related entries in the same file. |
| `collectionTitle` | Collection name. Set it on one member of the group. |
| `position` | Optional number controlling order within a collection. Ties retain file order; missing values appear last. |
| `collectionDescription` | Optional introduction shown inside the collection dialog. Set it on one member. |
| `collectionNote` | Optional personal note about the whole collection. Set it on one member. |

No ratings, tags, empty placeholders, fetched metadata dumps, or separate collections database are required. Collection metadata is read from the first member containing that field. If repeated, keep it consistent. Older `author`, `director`, `developer`, and `source` fields are also accepted by the renderer, but the supplied files consistently use `creator`.

### Book with a note

```json
{
  "id": "sapiens",
  "title": "Sapiens: A Brief History of Humankind",
  "creator": "Yuval Noah Harari",
  "year": 2011,
  "isbn": "9780062316097",
  "note": "My first paragraph.\n\nAnother thought on a new paragraph."
}
```

Use the ISBN of the edition you want. ISBNs must remain strings, including any leading zeros. Use digits without hyphens (or a final `X` for ISBN-10).

### Movie or series

```json
{
  "id": "tt2543164",
  "title": "Arrival",
  "creator": "Denis Villeneuve",
  "year": 2016
}
```

The IMDb ID supplies the poster lookup, so `imdbId` and a generated `image` URL do not need to be stored as well. The `movies.json` file continues to hold both movies and series.

### Game

```json
{
  "id": "hades",
  "title": "Hades",
  "year": 2020,
  "steamId": 1145360
}
```

For a console game or Steam artwork that uses a hashed path, use `image` instead of `steamId`. You can also host your own image at a relative path such as `assets/covers/my-game.jpg`. Steam remaster/PC artwork can differ from the original console edition; the collection's existing titles and release years are not rewritten to match that artwork.

### Bit

```json
{
  "id": "the-tail-end",
  "title": "The Tail End",
  "creator": "Tim Urban",
  "year": 2015,
  "link": "https://waitbutwhy.com/2015/12/the-tail-end.html"
}
```

Bits deliberately omit `image` for consistent title-only tiles. An explicit image remains supported if you decide to add one later.

### Collection

Add the same `collectionId` to each member. Place `collectionTitle`, and any optional collection description/note, on one member. Add `position` when you want a deliberate reading/viewing order. At least two entries are needed to display a collection tile; no collection content is lost when only one member exists.

### Notes

Add `"note": "Your text"` to any entry. Add `"collectionNote": "Your text"` to a member for a note about its collection. Use `\n\n` for paragraphs. Whitespace-only notes do not show a button. The button is a document-shaped icon with an accessible label, positioned outside the cover and outside the collection-opening button.

Notes are plain text. HTML and Markdown are not interpreted, and links are not automatically converted. No notes have been invented or added to the supplied data.

## Artwork and fallbacks

Book covers use Open Library; movie/series posters use Metahub with a Cinemeta fallback. Exact-title/creator matching is retained for failed book covers. Successful fallback URLs are cached locally for 30 days; disabling storage does not prevent rendering.

Games use standard Steam library artwork where available, exact Valve asset URLs for newer hashed assets, and explicit covers for console titles. Sources include Steam, Nintendo Life, Push Square, Pure Xbox, Power Up Gaming, and PriceCharting. Artwork remains owned by the respective rights holders. The site references the remote images rather than republishing downloaded copies.

Remote providers can change or become unavailable. If all candidates fail, the original styled text cover remains visible, with no broken-image icon. Set `image` to a locally hosted cover if you want control over availability. Bits do not make remote preview-image requests.

## Validation

The application validates required IDs/titles, duplicate IDs, years, Steam IDs, and notes when loading. Each file must contain valid JSON with no trailing commas. JavaScript syntax, all supplied JSON records, grouping/order, game-image initialization/fallbacks, note interactions, URL safety, and navigation were checked during this update. Full browser visual verification was unavailable in the build environment; responsive styles and native dialog behavior should also be previewed on your target devices before publishing.
