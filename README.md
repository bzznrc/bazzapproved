[Public website — bzznrc.github.io/bazzapproved](https://bzznrc.github.io/bazzapproved/)

## Data

Edit the JSON arrays in `data/books.json`, `movies.json`, `games.json`, `music.json` and `bits.json`. Each object represents one item. Omit optional fields rather than using empty placeholders or `null`.

| Field | Purpose |
| --- | --- |
| `id` | Required unique string within the file. Movies/series use their IMDb ID, such as `tt2543164`. |
| `title` | Required display title. |
| `creator` | Author, director, developer or artist. Required for Music; optional elsewhere. |
| `year` | Optional integer publication/release year, used for chronological ordering. |
| `isbn` | Books: ISBN-10 or ISBN-13, stored as a string without hyphens. |
| `steamId` | Games: positive integer Steam app ID for portrait artwork. |
| `igdbCoverId` | Games: exact cover token, such as `co1x77`, for catalogue artwork. |
| `portraitImage` | Games: optional preferred portrait image URL. |
| `spotifyId` | Music: optional 22-character Spotify album ID; album titles link to it automatically. |
| `image` | Optional artwork URL or relative local path, such as `assets/covers/example.jpg`. |
| `imageFallbacks` | Optional array of additional artwork URLs or local paths. |
| `imageFit` | `cover` (default) fills the tile; `contain` fits an illustration or chart without cropping it. |
| `link` | Optional destination URL. Music and Bits link their title; other sections show an “Open link” action. Music uses a Spotify album URL, with Spotify search as a fallback when an album ID is unavailable. |
| `note` | Optional plain-text note, with `\n\n` between paragraphs. |
| `collectionId` | Shared string grouping related items outside Music. |
| `collectionTitle` | Collection name; set on at least one member. |
| `collectionDescription` | Optional collection introduction, set on a member. |
| `collectionNote` | Optional plain-text note about the collection, set on a member. |
| `position` | Legacy field retained in existing data; chronological ordering takes precedence. |

Music uses direct, high-resolution cover URLs in `image`, with optional `imageFallbacks`; no account, API key or runtime catalogue request is needed. Music groups two or more albums by the same artist automatically; it ignores manual collection fields. Other sections group two or more items with the same `collectionId`.

Newest items appear first by default. Collections use their latest member year descending and earliest member year ascending. Undated items follow dated ones, alphabetically by creator then title; the same alphabetical rule breaks year ties.

Legacy `author`, `director`, `developer` and `source` fields are accepted as aliases for `creator`.

## Artwork minimums

| Artwork | Minimum source dimensions |
| --- | --- |
| Book covers | Prefer 250 × 375 pixels; retain a working cover down to 100 × 150 if no sharper source loads |
| Movie covers | 400 × 600 pixels |
| Album covers | 400 × 400 pixels, square |
| Article photos | At least 400 pixels on both sides |
| Contained illustrations/charts | At least 400 pixels on the longer side |
| Game covers | 600 × 800 pixels, portrait |

The same checks apply inside collections. Books keep a working cover visible while checking sharper alternatives; falling below the preferred size never removes that cover. Tiny placeholders are rejected. Other sections skip images below their minimum. Prefer a sharper original to an enlarged thumbnail.

Books use ISBN catalogues, then matching ISBN/title-and-author metadata alternatives. For a troublesome item, supply a suitable `image` and, optionally, `imageFallbacks`. The text cover or article icon appears only when no usable candidate loads.
