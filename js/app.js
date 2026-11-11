(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const areas = { books: 'Books', movies: 'Movies', games: 'Games', music: 'Music', bits: 'Bits' };
  const content = $('content');
  const collectionDialog = $('collection-dialog');
  const noteDialog = $('note-dialog');
  const dialogTriggers = new WeakMap();
  let data = {};
  let area = 'books';
  let ready = false;
  let oldestFirst = false;

  const text = value => typeof value === 'string' ? value : '';
  // The files use creator consistently; aliases also accept older entries.
  const creator = entry => text(entry.creator || entry.author || entry.director || entry.developer || entry.source);
  const norm = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function safeURL(value) {
    if (!text(value).trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function externalLink(href, className, title) {
    const link = el('a', className, title);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function noun(count, kind) {
    const singular = { books: 'book', movies: 'movie', games: 'game', music: 'album', bits: 'entry' }[kind];
    return count === 1 ? singular : kind === 'music' ? 'albums' : kind === 'bits' ? 'entries' : `${singular}s`;
  }

  function showDialog(dialog, button) {
    dialogTriggers.set(dialog, button);
    dialog.showModal();
    dialog.querySelector('.dialog-body').scrollTop = 0;
    document.body.classList.add('modal-open');
    dialog.querySelector('[data-close-dialog]').focus({ preventScroll: true });
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  // Native dialogs trap focus, support Escape, and make the background inert.
  for (const dialog of [collectionDialog, noteDialog]) {
    dialog.querySelector('[data-close-dialog]').addEventListener('click', () => closeDialog(dialog));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeDialog(dialog);
    });
    let pointerStartedOutside = false;
    const outside = event => {
      if (event.target !== dialog) return false;
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener('pointerdown', event => { pointerStartedOutside = outside(event); });
    dialog.addEventListener('click', event => {
      if (pointerStartedOutside && outside(event)) closeDialog(dialog);
      pointerStartedOutside = false;
    });
    dialog.addEventListener('close', () => {
      document.body.classList.toggle('modal-open', collectionDialog.open || noteDialog.open);
      const trigger = dialogTriggers.get(dialog);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }

  function noteButton(title, note) {
    if (!text(note).trim()) return null;
    const button = el('button', 'note-button');
    button.type = 'button';
    button.title = 'Read my note';
    button.setAttribute('aria-label', `Read my note on ${title}`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'note-dialog');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8M8 17h5');
    svg.append(path);
    button.append(svg);
    button.addEventListener('click', () => {
      $('note-title').textContent = title;
      // Notes are plain text: preserve paragraphs, never interpret HTML.
      $('note-content').textContent = note.trim();
      showDialog(noteDialog, button);
    });
    return button;
  }

  function metadata(byline, title, note) {
    const row = el('div', 'card-meta');
    if (byline) row.append(el('p', 'author', byline));
    const button = noteButton(title, note);
    if (button) row.append(button);
    return row.childNodes.length ? row : null;
  }

  function imageCandidates(entry, kind) {
    const urls = [];
    // Curated clean portraits are optional; the existing artwork stays as fallback.
    const portrait = kind === 'games' ? safeURL(entry.portraitImage) : null;
    if (portrait) urls.push(portrait);
    const catalogueCover = kind === 'games' && /^co[a-z0-9]+$/.test(text(entry.igdbCoverId)) ?
      ['t_original', 't_cover_big_2x'].map(size => `https://images.igdb.com/igdb/image/upload/${size}/${entry.igdbCoverId}.jpg`) : [];
    if (kind === 'games' && !entry.steamId) urls.push(...catalogueCover);
    const override = safeURL(entry.image);
    if (override) urls.push(override);
    const fallbacks = (Array.isArray(entry.imageFallbacks) ? entry.imageFallbacks : []).map(safeURL).filter(Boolean);
    if (kind !== 'games') urls.push(...fallbacks);
    if (kind === 'books' && /^\d{9}[\dX]$|^\d{13}$/.test(text(entry.isbn))) {
      urls.push(`https://covers.openlibrary.org/b/isbn/${entry.isbn}-L.jpg?default=false`);
      const isbn = isbn13(entry.isbn);
      if (isbn !== entry.isbn) urls.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`);
      urls.push(`https://images-us.bookshop.org/ingram/${isbn}.jpg`);
      // A second ISBN catalogue helps editions missing from Open Library.
      urls.push(`https://www.ibs.it/images/${isbn}_0_0_0_0_0.jpg`);
    }
    if (kind === 'movies' && /^tt\d+$/.test(entry.id)) {
      urls.push(`https://images.metahub.space/poster/medium/${entry.id}/img`);
    }
    if (kind === 'games' && Number.isSafeInteger(entry.steamId) && entry.steamId > 0) {
      // Ordinary image requests work cross-origin on GitHub Pages; Store Search
      // is a JSON API and does not reliably allow browser CORS requests.
      const base = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${entry.steamId}`;
      urls.push(`${base}/library_600x900_2x.jpg`, `${base}/library_600x900.jpg`);
    }
    if (kind === 'games' && entry.steamId) urls.push(...catalogueCover);
    if (kind === 'games') urls.push(...fallbacks);
    return [...new Set(urls)];
  }

  function isbn13(value) {
    if (value.length !== 10) return value;
    const digits = '978' + value.slice(0, 9);
    const sum = [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return digits + ((10 - sum % 10) % 10);
  }

  function meetsArtworkMinimum(entry, kind, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    // Books often have smaller catalogue originals. This is a preferred size;
    // keep a usable cover if none of its alternatives reaches this target.
    if (kind === 'books') return width >= 250 && height >= 375;
    if (kind === 'games') return width >= 600 && height >= 800 && height > width;
    if (kind === 'music') return width >= 400 && height >= 400 && Math.abs(width / height - 1) <= .02;
    // Contained drawings use their long edge; wide comics do not need to be square.
    if (kind === 'bits' && entry.imageFit === 'contain') return Math.max(width, height) >= 400;
    return width >= 400 && height >= (kind === 'bits' ? 400 : 600);
  }

  function metadataImageCandidates(value) {
    const url = safeURL(value);
    if (!url) return [];
    const parsed = new URL(url);
    if (parsed.hostname === 'images.metahub.space') return [url.replace('/poster/small/', '/poster/medium/')];
    if (['books.google.com', 'books.googleusercontent.com'].includes(parsed.hostname) && parsed.searchParams.has('zoom')) {
      // Ask for larger catalogue images; their actual pixels are still checked.
      return [3, 2, 1].map(zoom => {
        const candidate = new URL(url);
        candidate.searchParams.set('zoom', String(zoom));
        return candidate.href;
      });
    }
    return [url];
  }

  // Exhausted book/movie candidates need a metadata API. Bound concurrency and
  // share requests across the grid and open collections.
  const lookups = new Map();
  const pending = [];
  let active = 0;
  function runPending() {
    while (active < 3 && pending.length) {
      const { task, resolve } = pending.shift();
      active++;
      Promise.resolve().then(task).catch(() => null).then(resolve).finally(() => {
        active--;
        runPending();
      });
    }
  }
  function schedule(task) {
    return new Promise(resolve => { pending.push({ task, resolve }); runPending(); });
  }
  async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response.ok ? await response.json() : null;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  function resolveImage(entry, kind) {
    if (!['books', 'movies'].includes(kind)) return Promise.resolve([]);
    const key = `cover-v5:${kind}:${entry.id}:${entry.isbn || ''}`;
    if (lookups.has(key)) return lookups.get(key);
    const lookup = schedule(async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved && Date.now() - saved.time < 30 * 86400000 && Array.isArray(saved.urls)) {
          const urls = saved.urls.map(safeURL).filter(Boolean);
          if (urls.length) return urls;
        }
      } catch { /* Storage may be disabled; images still work. */ }
      const found = [];
      if (kind === 'movies' && /^tt\d+$/.test(entry.id)) {
        for (const type of ['movie', 'series']) {
          const result = await fetchJSON(`https://v3-cinemeta.strem.io/meta/${type}/${entry.id}.json`);
          found.push(...metadataImageCandidates(result?.meta?.poster));
          if (found.length) break;
        }
      } else if (kind === 'books') {
        // Match the edition by ISBN before attempting a title/author search.
        if (entry.isbn) {
          const result = await fetchJSON(`https://www.googleapis.com/books/v1/volumes?q=isbn:${entry.isbn}&maxResults=5`);
          const book = (Array.isArray(result?.items) ? result.items : []).find(item =>
            Array.isArray(item.volumeInfo?.industryIdentifiers) && item.volumeInfo.industryIdentifiers.some(identifier =>
              isbn13(text(identifier.identifier).replace(/-/g, '')) === isbn13(entry.isbn)));
          const images = book?.volumeInfo?.imageLinks;
          for (const field of ['extraLarge', 'large', 'medium', 'small', 'thumbnail', 'smallThumbnail']) {
            found.push(...metadataImageCandidates(text(images?.[field]).replace(/^http:/, 'https:')));
          }
        }
        // Keep an independent alternative when the ISBN catalogue has only a thumbnail.
        {
          const shortTitle = entry.title.replace(/\s*\([^)]*\)\s*$/, '').split(':')[0];
          const query = new URLSearchParams({ title: shortTitle, author: creator(entry), fields: 'title,author_name,cover_i', limit: '5' });
          const result = await fetchJSON(`https://openlibrary.org/search.json?${query}`);
          const surname = norm(creator(entry).split('&')[0]).split(' ').pop();
          const matches = (Array.isArray(result?.docs) ? result.docs : []).filter(item =>
            Number.isInteger(item.cover_i) && norm(text(item.title).split(':')[0]) === norm(shortTitle) &&
            (!surname || (Array.isArray(item.author_name) && item.author_name.some(name => norm(name).split(' ').includes(surname)))));
          for (const match of matches) found.push(`https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg?default=false`);
        }
      }
      const urls = [...new Set(found)];
      if (urls.length) {
        try { localStorage.setItem(key, JSON.stringify({ urls, time: Date.now() })); }
        catch { /* Optional cache. */ }
      }
      return urls;
    });
    lookups.set(key, lookup);
    return lookup;
  }

  function loadBookCover(image, node, entry, candidates) {
    let target = image;
    let best = null;
    let attemptedLookup = false;
    const attempted = new Set();

    const tryNext = async () => {
      let next = candidates.shift();
      while (next && attempted.has(next)) next = candidates.shift();
      if (next) { attempted.add(next); target.src = next; return; }
      if (!attemptedLookup && node.isConnected) {
        attemptedLookup = true;
        const found = await resolveImage(entry, 'books');
        if (node.isConnected) {
          candidates.push(...(Array.isArray(found) ? found : []).filter(url => !attempted.has(url)));
          if (candidates.length) { void tryNext(); return; }
        }
      }
      // A modest real cover is better than discarding it for the text tile.
      if (!best) image.remove();
    };

    const watch = candidate => {
      candidate.addEventListener('load', () => {
        if (candidate !== target) return;
        const width = candidate.naturalWidth;
        const height = candidate.naturalHeight;
        // Exclude blank catalogue placeholders and unusably tiny thumbnails.
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 150) {
          void tryNext(); return;
        }
        const score = Math.min(width / 250, height / 375);
        if (!best || score > best.score) {
          best = { url: candidate.src, score };
          if (candidate !== image) image.src = best.url;
          image.classList.add('loaded');
        }
        if (meetsArtworkMinimum(entry, 'books', width, height)) return;
        if (target === image) {
          // Probe upgrades separately so the working cover stays visible.
          target = el('img');
          target.referrerPolicy = image.referrerPolicy;
          watch(target);
        }
        void tryNext();
      });
      candidate.addEventListener('error', () => {
        if (candidate === target) void tryNext();
      });
    };
    watch(image);
    if (candidates.length) void tryNext();
    else queueMicrotask(() => { void tryNext(); });
  }

  function cover(entry, kind) {
    const tone = Array.from(entry.id).reduce((sum, char) => sum + char.codePointAt(0), 0) % 6;
    const node = el('div', `cover tone-${tone}${['bits', 'music'].includes(kind) ? ' square' : ''}${entry.imageFit === 'contain' ? ' contain' : ''}`);
    node.setAttribute('aria-hidden', 'true');
    const fallback = el('div', 'fallback');
    if (kind === 'bits') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 64 64');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.5');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M18 10h20l10 10v34H18zM38 10v12h10M25 32h16M25 39h16M25 46h10');
      icon.append(path);
      fallback.classList.add('article-fallback');
      fallback.append(icon);
    } else fallback.append(el('span', 'fallback-title', entry.title));
    // Article titles and creators are already visible below their image.
    if (kind !== 'bits' && creator(entry)) fallback.append(el('span', 'fallback-author', creator(entry)));
    node.append(fallback);
    const candidates = imageCandidates(entry, kind);
    if (!candidates.length && !['books', 'movies'].includes(kind)) return node;

    const image = el('img');
    image.alt = '';
    image.width = 400;
    image.height = ['bits', 'music'].includes(kind) ? 400 : 600;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    if (kind === 'books') {
      node.append(image);
      loadBookCover(image, node, entry, candidates);
      return node;
    }
    let attemptedLookup = false;
    const attempted = new Set();
    const tryNext = async () => {
      image.classList.remove('loaded');
      let next = candidates.shift();
      while (next && attempted.has(next)) next = candidates.shift();
      if (next) { attempted.add(next); image.src = next; return; }
      if (!attemptedLookup && node.isConnected) {
        attemptedLookup = true;
        const found = await resolveImage(entry, kind);
        if (node.isConnected) {
          candidates.push(...(Array.isArray(found) ? found : []).filter(url => !attempted.has(url)));
          if (candidates.length) { void tryNext(); return; }
        }
      }
      image.remove();
    };
    image.addEventListener('load', () => {
      if (!meetsArtworkMinimum(entry, kind, image.naturalWidth, image.naturalHeight)) {
        void tryNext(); return;
      }
      image.classList.add('loaded');
    });
    image.addEventListener('error', () => { void tryNext(); });
    node.append(image);
    // Attach to the document before an identifier-only fallback starts.
    if (candidates.length) void tryNext();
    else queueMicrotask(() => { void tryNext(); });
    return node;
  }

  function card(entry, kind) {
    const item = el('li', 'book');
    item.dataset.entryId = entry.id;
    item.append(cover(entry, kind));
    const heading = el('h2', 'item-title');
    const href = safeURL(kind === 'music' && entry.spotifyId ? `https://open.spotify.com/album/${entry.spotifyId}` : entry.link);
    if (['bits', 'music'].includes(kind) && href) heading.append(externalLink(href, 'title-link', entry.title));
    else heading.textContent = entry.title;
    item.append(heading);
    const byline = [creator(entry), Number.isInteger(entry.year) ? entry.year : ''].filter(Boolean).join(' · ');
    const meta = metadata(byline, entry.title, entry.note);
    if (meta) item.append(meta);
    if (!['bits', 'music'].includes(kind) && href) item.append(externalLink(href, 'entry-link', 'Open link'));
    return item;
  }

  function collectionMetadata(members) {
    const first = field => text(members.find(entry => text(entry[field]).trim())?.[field]);
    return {
      id: members[0].collectionId,
      title: first('collectionTitle') || members[0].collectionId,
      description: first('collectionDescription'),
      note: first('collectionNote')
    };
  }

  function openCollection(collection, members, button, kind) {
    $('dialog-title').textContent = collection.title;
    const meta = metadata(`${members.length} ${noun(members.length, kind)}`, collection.title, collection.note);
    $('dialog-meta').replaceChildren(...(meta ? [...meta.childNodes] : []));
    $('dialog-description').textContent = collection.description;
    $('dialog-description').hidden = !collection.description.trim();
    $('dialog-books').replaceChildren(...members.map((entry, index) => {
      const item = card(entry, kind);
      item.style.setProperty('--reveal-delay', `${Math.min(index, 7) * 30}ms`);
      return item;
    }));
    showDialog(collectionDialog, button);
  }

  function collectionCard(collection, members, kind) {
    const item = el('li', 'book collection-card');
    const button = el('button', 'collection-trigger');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'collection-dialog');
    button.setAttribute('aria-label', `Open ${collection.title}, ${members.length} ${noun(members.length, kind)}`);
    const stack = el('div', `cover-stack${['bits', 'music'].includes(kind) ? ' square' : ''}`);
    stack.setAttribute('aria-hidden', 'true');
    stack.dataset.layers = String(Math.min(members.length, 3));
    members.slice(0, 3).reverse().forEach((entry, index, layers) => {
      const layer = cover(entry, kind);
      layer.classList.add('stack-cover');
      layer.style.setProperty('--depth', layers.length - index - 1);
      stack.append(layer);
    });
    const action = el('span', 'collection-action');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4');
    icon.append(path);
    const arrow = el('span', 'collection-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    action.append(icon, el('span', '', `Collection · ${members.length} ${noun(members.length, kind)}`), arrow);
    button.append(stack, el('h2', 'item-title', collection.title), action);
    button.addEventListener('click', () => openCollection(collection, members, button, kind));
    item.append(button);
    const creators = [...new Set(members.map(creator).filter(Boolean))];
    const byline = creators.length === 1 ? creators[0] : '';
    const meta = metadata(byline, collection.title, collection.note);
    if (meta) item.append(meta);
    return item;
  }

  function groupKey(entry, kind) {
    // Music has exactly one grouping criterion: the credited artist.
    return kind === 'music' ? `music-artist-${norm(creator(entry))}` : entry.collectionId;
  }

  const alphabet = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  function compareEntries(a, b) {
    const datedA = Number.isInteger(a.year);
    const datedB = Number.isInteger(b.year);
    // Missing dates stay at the end in both directions.
    if (datedA !== datedB) return datedA ? -1 : 1;
    if (datedA && a.year !== b.year) return oldestFirst ? a.year - b.year : b.year - a.year;
    return alphabet.compare(creator(a).trim(), creator(b).trim()) ||
      alphabet.compare(a.title, b.title) || alphabet.compare(a.id, b.id);
  }

  function render() {
    const entries = data[area];
    $('count').textContent = `${entries.length} ${noun(entries.length, area)}`;
    const sortToggle = $('sort-toggle');
    sortToggle.disabled = false;
    sortToggle.setAttribute('aria-pressed', String(oldestFirst));
    sortToggle.setAttribute('aria-label', oldestFirst ? 'Show newest first' : 'Show oldest first');
    sortToggle.title = oldestFirst ? 'Oldest first · click for newest first' : 'Newest first · click for oldest first';
    content.replaceChildren();
    content.setAttribute('aria-busy', 'false');
    if (!entries.length) { content.append(el('p', 'empty', `No ${areas[area].toLowerCase()} yet.`)); return; }
    const groups = new Map();
    for (const entry of entries) {
      const key = groupKey(entry, area);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const list = el('ul', 'grid');
    list.setAttribute('aria-label', areas[area]);
    const seen = new Set();
    const items = [];
    for (const entry of entries) {
      const key = groupKey(entry, area);
      const members = groups.get(key);
      if (!members || members.length < 2) { items.push({ entry }); continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      const collection = collectionMetadata(members);
      if (area === 'music') { collection.id = key; collection.title = creator(members[0]); }
      const years = members.map(member => member.year).filter(Number.isInteger);
      const creators = [...new Set(members.map(creator).filter(Boolean))].sort(alphabet.compare);
      items.push({ collection, members: [...members].sort(compareEntries), entry: {
        id: collection.id, title: collection.title, creator: creators.join(', '),
        year: years.length ? (oldestFirst ? Math.min(...years) : Math.max(...years)) : undefined
      } });
    }
    items.sort((a, b) => compareEntries(a.entry, b.entry));
    for (const item of items) {
      list.append(item.collection ? collectionCard(item.collection, item.members, area) : card(item.entry, area));
    }
    content.append(list);
  }

  function navigate() {
    const hash = location.hash.slice(1);
    if (hash === 'main' && document.body.dataset.area) return;
    closeDialog(noteDialog);
    closeDialog(collectionDialog);
    area = Object.hasOwn(areas, hash) ? hash : 'books';
    oldestFirst = false;
    document.body.dataset.area = area;
    $('area-title').textContent = areas[area];
    document.title = `${areas[area]} | My collection`;
    document.querySelectorAll('a[data-area]').forEach(link => {
      if (link.dataset.area === area) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    render();
  }

  function validate(entries, name) {
    if (!Array.isArray(entries)) throw Error(`${name}.json must be an array`);
    const ids = new Set();
    for (const entry of entries) {
      if (!entry || !text(entry.id).trim() || !text(entry.title).trim() || ids.has(entry.id)) throw Error(`Missing or duplicate id/title in ${name}.json`);
      if (entry.year !== undefined && !Number.isInteger(entry.year)) throw Error(`Invalid year for ${entry.id}`);
      if (entry.steamId !== undefined && (!Number.isSafeInteger(entry.steamId) || entry.steamId <= 0)) throw Error(`Invalid Steam id for ${entry.id}`);
      if (entry.igdbCoverId !== undefined && !/^co[a-z0-9]+$/.test(text(entry.igdbCoverId))) throw Error(`Invalid IGDB cover id for ${entry.id}`);
      if (entry.spotifyId !== undefined && !/^[A-Za-z0-9]{22}$/.test(text(entry.spotifyId))) throw Error(`Invalid Spotify id for ${entry.id}`);
      if (name === 'music' && !norm(creator(entry))) throw Error(`Missing artist for ${entry.id}`);
      if (entry.note !== undefined && typeof entry.note !== 'string') throw Error(`Invalid note for ${entry.id}`);
      if (entry.imageFallbacks !== undefined && (!Array.isArray(entry.imageFallbacks) || entry.imageFallbacks.some(url => !safeURL(url)))) throw Error(`Invalid image fallbacks for ${entry.id}`);
      if (entry.imageFit !== undefined && !['cover', 'contain'].includes(entry.imageFit)) throw Error(`Invalid image fit for ${entry.id}`);
      ids.add(entry.id);
    }
    return entries;
  }

  $('sort-toggle').addEventListener('click', () => {
    if (!ready) return;
    oldestFirst = !oldestFirst;
    render();
  });
  window.addEventListener('hashchange', () => { if (ready) navigate(); });
  Promise.all(Object.keys(areas).map(async name => {
    const response = await fetch(`data/${name}.json`);
    if (!response.ok) throw Error(`Could not load ${name}.json`);
    return [name, validate(await response.json(), name)];
  })).then(results => {
    data = Object.fromEntries(results);
    ready = true;
    navigate();
    if (location.hash === '#main') $('main').focus({ preventScroll: true });
  }).catch(error => {
    console.error(error);
    $('count').textContent = 'Unable to load';
    content.setAttribute('aria-busy', 'false');
    content.replaceChildren(el('p', 'empty', 'The collection could not be loaded. Please try reloading the page.'));
  });
})();
