(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const areas = { books: 'Books', movies: 'Movies', games: 'Games', bits: 'Bits' };
  const content = $('content');
  const collectionDialog = $('collection-dialog');
  const noteDialog = $('note-dialog');
  const dialogTriggers = new WeakMap();
  let data = {};
  let area = 'books';
  let ready = false;

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
    const singular = { books: 'book', movies: 'movie', games: 'game', bits: 'entry' }[kind];
    return count === 1 ? singular : kind === 'bits' ? 'entries' : `${singular}s`;
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
    const override = safeURL(entry.image);
    if (override) urls.push(override);
    if (kind === 'books' && /^\d{9}[\dX]$|^\d{13}$/.test(text(entry.isbn))) {
      urls.push(`https://covers.openlibrary.org/b/isbn/${entry.isbn}-L.jpg?default=false`);
    }
    if (kind === 'movies' && /^tt\d+$/.test(entry.id)) {
      urls.push(`https://images.metahub.space/poster/small/${entry.id}/img`);
    }
    if (kind === 'games' && Number.isSafeInteger(entry.steamId) && entry.steamId > 0) {
      // Ordinary image requests work cross-origin on GitHub Pages; Store Search
      // is a JSON API and does not reliably allow browser CORS requests.
      const base = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${entry.steamId}`;
      urls.push(`${base}/library_600x900.jpg`, `${base}/library_600x900_2x.jpg`, `${base}/header.jpg`);
    }
    return [...new Set(urls)];
  }

  // Only failed book/movie images need a metadata API. Bound concurrency and
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
    if (!['books', 'movies'].includes(kind)) return Promise.resolve(null);
    const key = `cover-v3:${kind}:${entry.id}:${entry.isbn || ''}`;
    if (lookups.has(key)) return lookups.get(key);
    const lookup = schedule(async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved && Date.now() - saved.time < 30 * 86400000 && safeURL(saved.url)) return saved.url;
      } catch { /* Storage may be disabled; images still work. */ }
      let found = null;
      if (kind === 'movies' && /^tt\d+$/.test(entry.id)) {
        for (const type of ['movie', 'series']) {
          const result = await fetchJSON(`https://v3-cinemeta.strem.io/meta/${type}/${entry.id}.json`);
          found = safeURL(result?.meta?.poster);
          if (found) break;
        }
      } else if (kind === 'books') {
        const shortTitle = entry.title.replace(/\s*\([^)]*\)\s*$/, '').split(':')[0];
        const query = new URLSearchParams({ title: shortTitle, author: creator(entry), fields: 'title,author_name,cover_i', limit: '5' });
        const result = await fetchJSON(`https://openlibrary.org/search.json?${query}`);
        const surname = norm(creator(entry).split('&')[0]).split(' ').pop();
        const match = (Array.isArray(result?.docs) ? result.docs : []).find(item =>
          Number.isInteger(item.cover_i) && norm(text(item.title).split(':')[0]) === norm(shortTitle) &&
          (!surname || (Array.isArray(item.author_name) && item.author_name.some(name => norm(name).split(' ').includes(surname)))));
        if (match) found = `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg?default=false`;
      }
      if (found) {
        try { localStorage.setItem(key, JSON.stringify({ url: found, time: Date.now() })); }
        catch { /* Optional cache. */ }
      }
      return found;
    });
    lookups.set(key, lookup);
    return lookup;
  }

  function cover(entry, kind) {
    const tone = Array.from(entry.id).reduce((sum, char) => sum + char.codePointAt(0), 0) % 6;
    const node = el('div', `cover tone-${tone}${kind === 'bits' ? ' landscape' : ''}`);
    node.setAttribute('aria-hidden', 'true');
    const fallback = el('div', 'fallback');
    fallback.append(el('span', 'fallback-title', entry.title));
    // Bits are deliberately title-only. The creator remains in the byline.
    if (kind !== 'bits' && creator(entry)) fallback.append(el('span', 'fallback-author', creator(entry)));
    node.append(fallback);
    const candidates = imageCandidates(entry, kind);
    if (!candidates.length && !['books', 'movies'].includes(kind)) return node;

    const image = el('img');
    image.alt = '';
    image.width = 400;
    image.height = kind === 'bits' ? 250 : 600;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    let attemptedLookup = false;
    const tryNext = async () => {
      image.classList.remove('loaded');
      const next = candidates.shift();
      if (next) { image.src = next; return; }
      if (!attemptedLookup && node.isConnected) {
        attemptedLookup = true;
        const found = await resolveImage(entry, kind);
        if (found && node.isConnected && image.src !== found) { image.src = found; return; }
      }
      image.remove();
    };
    image.addEventListener('load', () => {
      // Open Library can return tiny placeholders instead of an HTTP error.
      if (image.naturalWidth < 20 || image.naturalHeight < 20) { void tryNext(); return; }
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
    const href = safeURL(entry.link);
    if (kind === 'bits' && href) heading.append(externalLink(href, 'title-link', entry.title));
    else heading.textContent = entry.title;
    item.append(heading);
    const byline = [creator(entry), Number.isInteger(entry.year) ? entry.year : ''].filter(Boolean).join(' · ');
    const meta = metadata(byline, entry.title, entry.note);
    if (meta) item.append(meta);
    if (kind !== 'bits' && href) item.append(externalLink(href, 'entry-link', 'Open link'));
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
    const stack = el('div', `cover-stack${kind === 'bits' ? ' landscape' : ''}`);
    stack.setAttribute('aria-hidden', 'true');
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

  function render() {
    const entries = data[area];
    $('count').textContent = `${entries.length} ${noun(entries.length, area)}`;
    content.replaceChildren();
    content.setAttribute('aria-busy', 'false');
    if (!entries.length) { content.append(el('p', 'empty', `No ${areas[area].toLowerCase()} yet.`)); return; }
    const groups = new Map();
    for (const entry of entries) {
      if (!entry.collectionId) continue;
      if (!groups.has(entry.collectionId)) groups.set(entry.collectionId, []);
      groups.get(entry.collectionId).push(entry);
    }
    const list = el('ul', 'grid');
    list.setAttribute('aria-label', areas[area]);
    const seen = new Set();
    for (const entry of entries) {
      const members = groups.get(entry.collectionId);
      if (!members || members.length < 2) { list.append(card(entry, area)); continue; }
      if (seen.has(entry.collectionId)) continue;
      seen.add(entry.collectionId);
      members.sort((a, b) => (Number.isFinite(a.position) ? a.position : Infinity) - (Number.isFinite(b.position) ? b.position : Infinity));
      list.append(collectionCard(collectionMetadata(members), members, area));
    }
    content.append(list);
  }

  function navigate() {
    const hash = location.hash.slice(1);
    if (hash === 'main' && document.body.dataset.area) return;
    closeDialog(noteDialog);
    closeDialog(collectionDialog);
    area = Object.hasOwn(areas, hash) ? hash : 'books';
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
      if (entry.note !== undefined && typeof entry.note !== 'string') throw Error(`Invalid note for ${entry.id}`);
      ids.add(entry.id);
    }
    return entries;
  }

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
