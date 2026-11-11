const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const database = Object.fromEntries(['books', 'movies', 'games', 'music', 'bits'].map(kind =>
  [kind, JSON.parse(fs.readFileSync(path.join(root, `data/${kind}.json`), 'utf8'))]));
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

// Small DOM adapter: execute the actual app and its event handlers without
// requiring browser downloads or network access for deterministic tests.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.handlers = {};
    this.className = '';
    this._text = '';
    this.isConnected = true;
    this.open = false;
    this.properties = {};
    this.style = { setProperty: (key, value) => { this.properties[key] = value; } };
    this.classList = {
      add: value => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), value])].join(' '); },
      remove: value => { this.className = this.className.split(' ').filter(item => item !== value).join(' '); },
      contains: value => this.className.split(' ').includes(value),
      toggle: (value, on) => on ? this.classList.add(value) : this.classList.remove(value)
    };
  }
  get childNodes() { return this.children; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(key, fn) { (this.handlers[key] ||= []).push(fn); }
  emit(key, event = {}) { for (const fn of this.handlers[key] || []) fn(event); }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  querySelector(selector) { return this.special?.[selector] || null; }
}

function descendants(node, predicate) {
  return [node, ...node.children.flatMap(child => descendants(child, () => true))].filter(predicate);
}
function snapshot(node) {
  return { tag: node.tagName, className: node.className, text: node._text, attributes: node.attributes,
    dataset: node.dataset, src: node.src?.replace('/poster/small/', '/poster/medium/'), children: node.children.map(snapshot) };
}

async function boot({ code = source, music = database.music, datasets = {}, fetchMetadata, storage = new Map() } = {}) {
  const ids = new Map();
  for (const id of ['content', 'collection-dialog', 'note-dialog', 'dialog-title', 'dialog-meta', 'dialog-description', 'dialog-books', 'note-title', 'note-content', 'count', 'main', 'area-title', 'sort-toggle']) ids.set(id, new Element());
  for (const id of ['collection-dialog', 'note-dialog']) ids.get(id).special = { '.dialog-body': new Element(), '[data-close-dialog]': new Element('button') };
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const head = new Element('head');
  const images = [];
  const document = { baseURI: 'https://example.test/', head, body: new Element('body'), title: '',
    getElementById: id => ids.get(id), createElement: tag => {
      const node = new Element(tag);
      if (tag === 'img') images.push(node);
      return node;
    },
    createElementNS: (_, tag) => new Element(tag), querySelectorAll: () => [] };
  const context = { console, URL, URLSearchParams, document, location: { hash: '#books' }, queueMicrotask,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id), AbortController,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async url => {
      const match = /^data\/(\w+)\.json$/.exec(url);
      if (!match) { requests.push(url); return fetchMetadata ? fetchMetadata(url) : { ok: false, json: async () => null }; }
      return { ok: true, json: async () => structuredClone(datasets[match[1]] || (match[1] === 'music' ? music : database[match[1]])) };
    } };
  context.window = context;
  context.addEventListener = () => {};
  const exposed = code.replace(/\}\)\(\);\s*$/, 'globalThis.__app = { navigate, validate, meetsArtworkMinimum: typeof meetsArtworkMinimum === "function" ? meetsArtworkMinimum : undefined };\n})();');
  vm.runInNewContext(exposed, context);
  await flush();
  return { context, ids, requests, timers, storage, music, images,
    navigate: async kind => { context.location.hash = '#' + kind; context.__app.navigate(); await flush(); } };
}

test('68 albums form exactly 16 artist collections and 31 standalone cards', async () => {
  const app = await boot(); await app.navigate('music');
  assert.equal(app.ids.get('count').textContent, '68 albums');
  const cards = app.ids.get('content').children[0].children;
  assert.equal(cards.length, 47);
  const collections = cards.filter(card => card.classList.contains('collection-card'));
  assert.equal(collections.length, 16);
  assert.deepEqual(collections.map(card => card.children[0].children[1].textContent).sort(), [
    'Bilmuri', 'Charli xcx', 'Deftones', 'Hadouken!', 'Linkin Park', 'Murubutu', 'Pippo Sowlo',
    'Porcupine Tree', 'Porter Robinson', 'Royal Blood', 'Sleep Token', 'Sum 41', 'System Of A Down',
    'Taylor Swift', 'blink-182', 'i cani'
  ].sort());
  for (const card of cards) {
    const covers = descendants(card, node => node.classList.contains('cover'));
    assert(covers.every(cover => cover.classList.contains('square')));
  }
  const button = collections.find(card => card.children[0].children[1].textContent === 'Deftones').children[0]; button.emit('click');
  assert.equal(app.ids.get('collection-dialog').open, true);
  assert.equal(app.ids.get('dialog-title').textContent, 'Deftones');
  assert.equal(app.ids.get('dialog-books').children.length, 3);
  assert.deepEqual(app.ids.get('dialog-books').children.map(card => card.children[1].textContent), ['Koi No Yokan', 'Diamond Eyes', 'White Pony']);
  assert(descendants(app.ids.get('dialog-books'), node => node.classList.contains('cover')).every(node => node.classList.contains('square')));
});

test('artist alone determines collections; unrelated manual IDs and order are ignored', async () => {
  const music = [
    { id: 'one', title: 'One', creator: 'First Artist', collectionId: 'mixed', position: 2 },
    { id: 'two', title: 'Two', creator: 'Second Artist', collectionId: 'mixed' },
    { id: 'three', title: 'Three', creator: ' first artist ', collectionId: 'different', position: 1 }
  ];
  const app = await boot({ music }); await app.navigate('music');
  const cards = app.ids.get('content').children[0].children;
  assert.equal(cards.length, 2);
  cards[0].children[0].emit('click');
  assert.equal(app.ids.get('dialog-title').textContent, 'First Artist');
  assert.deepEqual(app.ids.get('dialog-books').children.map(card => card.children[1].textContent), ['One', 'Three']);
  assert(!cards[1].classList.contains('collection-card'));
});

test('all sections show two covers for pairs and cap larger collection stacks at three', async () => {
  const entries = [2, 3, 5].flatMap(count => Array.from({ length: count }, (_, index) => ({
    id: `group-${count}-${index}`, title: `Item ${count}-${index}`, creator: `Creator ${count}`,
    year: 2000 + index, collectionId: `group-${count}`, collectionTitle: `Group ${count}`
  })));
  const datasets = Object.fromEntries(Object.keys(database).map(kind => [kind, entries]));
  const app = await boot({ datasets });
  for (const kind of Object.keys(database)) {
    await app.navigate(kind);
    const stacks = descendants(app.ids.get('content'), node => node.classList.contains('cover-stack'));
    assert.equal(stacks.length, 3);
    assert.deepEqual(stacks.map(stack => stack.dataset.layers).sort(), ['2', '3', '3']);
    for (const stack of stacks) {
      const count = Number(stack.dataset.layers);
      assert.equal(stack.children.length, count);
      assert.deepEqual(stack.children.map(layer => layer.properties['--depth']),
        Array.from({ length: count }, (_, index) => count - index - 1));
    }
  }
});

test('music uses direct covers and Spotify title links without scripts, API keys or catalogue requests', async () => {
  const app = await boot(); await app.navigate('music');
  const check = root => {
    for (const card of root.children) {
      if (card.classList.contains('collection-card')) continue;
      const entry = database.music.find(entry => entry.id === card.dataset.entryId);
      const image = descendants(card, node => node.tagName === 'img')[0];
      assert(image && image.src === entry.image, entry.id);
      assert.equal(image.width, image.height);
      image.naturalWidth = 640; image.naturalHeight = 640; image.emit('load');
      assert(image.classList.contains('loaded'));
      const heading = card.children[1];
      assert.equal(heading.children.length, 1);
      const link = heading.children[0];
      assert.equal(link.textContent, entry.title);
      assert.equal(link.href, entry.link);
      assert.equal(link.target, '_blank');
      assert.equal(link.rel, 'noopener noreferrer');
      assert(link.classList.contains('title-link'));
      assert.equal(descendants(card, node => node.classList.contains('entry-link')).length, 0);
    }
  };
  check(app.ids.get('content').children[0]);
  for (const card of cardsOf(app).filter(card => card.classList.contains('collection-card'))) {
    card.children[0].emit('click');
    check(app.ids.get('dialog-books'));
    app.ids.get('collection-dialog').close();
  }
  assert.equal(app.requests.length, 0);
  assert.equal(app.context.document.head.children.length, 0);
});

test('a Spotify ID provides the album title destination even without a manual link', async () => {
  const entry = { id: 'one', title: 'White Pony', creator: 'Deftones', spotifyId: '5LEXck3kfixFaA3CqVE7bC', image: 'https://example.test/cover.jpg' };
  const app = await boot({ music: [entry] }); await app.navigate('music');
  const card = cardsOf(app)[0];
  const link = card.children[1].children[0];
  assert.equal(link.href, 'https://open.spotify.com/album/' + entry.spotifyId);
  assert.equal(link.textContent, entry.title);
  assert(!card.textContent.includes('Open link'));
});

test('music rejects small artwork, advances through direct fallbacks and retains a readable card on failure', async () => {
  const entry = { id: 'one', title: 'One', creator: 'Artist', image: 'https://example.test/small.jpg',
    imageFallbacks: ['https://example.test/large.jpg', 'https://example.test/backup.jpg'] };
  const app = await boot({ music: [entry] }); await app.navigate('music');
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  image.naturalWidth = 300; image.naturalHeight = 300; image.emit('load'); await flush();
  assert.equal(image.src, entry.imageFallbacks[0]);
  image.emit('error'); await flush();
  assert.equal(image.src, entry.imageFallbacks[1]);
  image.naturalWidth = 640; image.naturalHeight = 640; image.emit('load');
  assert(image.classList.contains('loaded'));
  image.emit('error'); await flush();
  assert.equal(descendants(app.ids.get('content'), node => node.tagName === 'img').length, 0);
  assert(app.ids.get('content').textContent.includes(entry.title));
  assert(app.ids.get('content').textContent.includes(entry.creator));
  assert.equal(app.requests.length, 0);
});

test('manual square covers reject low-resolution and non-square images', async () => {
  const app = await boot({ music: [{ id: 'one', title: 'One', creator: 'Artist', image: 'https://example.test/one.jpg' }] });
  await app.navigate('music');
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  image.naturalWidth = 1200; image.naturalHeight = 600; image.emit('load'); await flush();
  assert.equal(descendants(app.ids.get('content'), node => node.tagName === 'img').length, 0);
});

test('every category passes the schema; a music entry requires an artist', async () => {
  const app = await boot();
  for (const [kind, entries] of Object.entries(database)) app.context.__app.validate(entries, kind);
  assert.throws(() => app.context.__app.validate([{ id: 'one', title: 'One' }], 'music'), /Missing artist/);
  assert.throws(() => app.context.__app.validate([{ id: 'one', title: 'One', creator: 'Artist', spotifyId: 'bad-id' }], 'music'), /Invalid Spotify id/);
});

const cardsOf = app => app.ids.get('content').children[0].children;
const titlesOf = app => cardsOf(app).map(card => card.classList.contains('collection-card') ?
  card.children[0].children[1].textContent : card.children[1].textContent);
const toggle = async app => { app.ids.get('sort-toggle').emit('click'); await flush(); };

test('every page starts newest first, toggles twice, and resets on navigation', async () => {
  const entries = [
    { id: 'old', title: 'Old', creator: 'One', year: 1994 },
    { id: 'new', title: 'New', creator: 'Two', year: 2025 },
    { id: 'middle', title: 'Middle', creator: 'Three', year: 2010 }
  ];
  const datasets = Object.fromEntries(Object.keys(database).map(kind => [kind, entries]));
  const before = JSON.stringify(datasets);
  const app = await boot({ datasets });
  for (const kind of Object.keys(database)) {
    await app.navigate(kind);
    assert.deepEqual(titlesOf(app), ['New', 'Middle', 'Old'], kind);
    const button = app.ids.get('sort-toggle');
    assert.equal(button.disabled, false);
    assert.equal(button.attributes['aria-label'], 'Show oldest first');
    assert.equal(button.attributes['aria-pressed'], 'false');
    await toggle(app);
    assert.deepEqual(titlesOf(app), ['Old', 'Middle', 'New'], kind);
    assert.equal(button.attributes['aria-label'], 'Show newest first');
    assert.equal(button.attributes['aria-pressed'], 'true');
    await toggle(app);
    assert.deepEqual(titlesOf(app), ['New', 'Middle', 'Old'], kind);
    await toggle(app);
    await app.navigate(kind);
    assert.deepEqual(titlesOf(app), ['New', 'Middle', 'Old'], 'navigation resets direction');
  }
  assert.equal(JSON.stringify(datasets), before);
});

test('collections use newest/earliest member years and dialogs follow the chosen direction', async () => {
  for (const kind of Object.keys(database)) {
    const entries = [
      { id: 'old', title: 'Old member', creator: 'Band', year: 1990, collectionId: 'group', collectionTitle: 'Group', position: 1 },
      { id: 'middle', title: 'Middle', creator: 'Another', year: 2010 },
      { id: 'new', title: 'New member', creator: 'Band', year: 2025, collectionId: 'group', position: 2 },
      { id: 'unknown', title: 'Undated member', creator: 'Band', collectionId: 'group', position: 0 },
      { id: 'older', title: 'Older', creator: 'Separate', year: 1980 },
      { id: 'newer', title: 'Newer', creator: 'Recent', year: 2026 }
    ];
    const app = await boot({ datasets: { [kind]: entries } }); await app.navigate(kind);
    const title = kind === 'music' ? 'Band' : 'Group';
    assert.deepEqual(titlesOf(app), ['Newer', title, 'Middle', 'Older'], kind);
    cardsOf(app)[1].children[0].emit('click');
    assert.deepEqual(app.ids.get('dialog-books').children.map(card => card.dataset.entryId), ['new', 'old', 'unknown']);
    app.ids.get('collection-dialog').close();
    await toggle(app);
    assert.deepEqual(titlesOf(app), ['Older', title, 'Middle', 'Newer'], kind);
    cardsOf(app)[1].children[0].emit('click');
    assert.deepEqual(app.ids.get('dialog-books').children.map(card => card.dataset.entryId), ['old', 'new', 'unknown']);
  }
});

test('undated entries stay last, ordered by creator then title, and year ties use the same fallback', async () => {
  const entries = [
    { id: 'z', title: 'Zebra', author: 'Áda' },
    { id: 'b', title: 'First', source: 'Bob' },
    { id: 'a', title: 'Apple', creator: 'ada' },
    { id: 'dated-b', title: 'B', author: 'Bob', year: 2010 },
    { id: 'dated-z', title: 'Z', creator: 'Ada', year: 2010 },
    { id: 'dated-a', title: 'A', creator: 'ada', year: 2010 }
  ];
  const app = await boot({ datasets: { bits: entries } }); await app.navigate('bits');
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(cardsOf(app).map(card => card.dataset.entryId), ['dated-a', 'dated-z', 'dated-b', 'a', 'z', 'b']);
    await toggle(app);
  }
});

test('empty and entirely undated collections remain usable in both directions', async () => {
  const app = await boot({ datasets: { bits: [], music: [
    { id: 'z', title: 'Zebra', creator: 'Artist' },
    { id: 'a', title: 'Apple', creator: 'Artist' }
  ] } });
  await app.navigate('bits'); await toggle(app);
  assert.equal(app.ids.get('count').textContent, '0 entries');
  assert(app.ids.get('content').textContent.includes('No bits yet.'));
  await app.navigate('music');
  for (let i = 0; i < 2; i++) {
    cardsOf(app)[0].children[0].emit('click');
    assert.deepEqual(app.ids.get('dialog-books').children.map(card => card.dataset.entryId), ['a', 'z']);
    app.ids.get('collection-dialog').close(); await toggle(app);
  }
});

test('release data has unique albums and catalogue IDs, original years and requested spelling corrections', () => {
  const ids = database.music.map(entry => entry.spotifyId).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.length >= 66);
  for (const entry of database.music) {
    const link = new URL(entry.link);
    assert.equal(link.origin, 'https://open.spotify.com');
    assert.equal(decodeURIComponent(link.pathname), entry.spotifyId ? '/album/' + entry.spotifyId : '/search/' + entry.creator + ' ' + entry.title);
    assert(/^https:\/\//.test(entry.image), entry.id);
  }
  const keys = database.music.map(entry => entry.creator.toLowerCase() + ':' + entry.title.toLowerCase());
  assert.equal(new Set(keys).size, 68);
  const album = title => database.music.find(entry => entry.title === title);
  assert.equal(album('Mezmerize').year, 2005);
  assert.equal(album('The Bones of What You Believe').creator, 'CHVRCHES');
  assert.equal(album('Fair Youth').year, 2014);
  assert.equal(album('Weezer (White Album)').year, 2016);
  assert.equal(album('Weezer (White Album)').spotifyId, '6StNTJJ7Yq3Hf121kLvPBz');
  assert(!album('Weezer'));
  assert.equal(database.music.filter(entry => entry.title === 'Take Me Back To Eden').length, 1);
  assert.equal(database.music.filter(entry => entry.title === 'Every Weekend').length, 1);
});

test('Scurati has the five requested volumes, years and ISBNs in one collection', () => {
  const books = database.books.filter(book => book.creator === 'Antonio Scurati').sort((a, b) => a.year - b.year);
  assert.deepEqual(books.map(book => [book.title, book.year, book.isbn]), [
    ['M. Il figlio del secolo', 2018, '9788845298134'],
    ["M. L'uomo della provvidenza", 2020, '9788830102651'],
    ["M. Gli ultimi giorni dell'Europa", 2022, '9788830104969'],
    ["M. L'ora del destino", 2024, '9788830104976'],
    ['M. La fine e il principio', 2025, '9788830106987']
  ]);
  assert(books.every(book => book.collectionId === 'books-m' && book.image));
  assert.equal(database.books.length, 64);
  assert.equal(database.bits.find(entry => entry.id === 'gerontonomia').year, 2026);
});

test('articles have images and square cards/stacks/dialog covers without repeating the title in the tile', async () => {
  assert(database.bits.every(entry => /^https:/.test(entry.image)));
  const app = await boot(); await app.navigate('bits');
  const check = root => {
    const covers = descendants(root, node => node.classList.contains('cover'));
    assert(covers.length > 0);
    for (const cover of covers) {
      assert(cover.classList.contains('square'));
      assert(!cover.classList.contains('landscape'));
      assert.equal(descendants(cover, node => node.classList.contains('fallback-title')).length, 0);
      const image = descendants(cover, node => node.tagName === 'img')[0];
      assert(image && image.src && image.width === image.height);
    }
  };
  check(app.ids.get('content'));
  for (const card of cardsOf(app).filter(card => card.classList.contains('collection-card'))) {
    assert(card.children[0].children[0].classList.contains('square'));
    card.children[0].emit('click'); check(app.ids.get('dialog-books')); app.ids.get('collection-dialog').close();
  }
});

test('game covers reject landscape and small images and keep the high-resolution banner fallback', async () => {
  const game = { id: 'game', title: 'Game', igdbCoverId: 'co1234', image: 'https://example.test/banner.jpg' };
  const app = await boot({ datasets: { games: [game] } }); await app.navigate('games');
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  assert(image.src.includes('/t_original/co1234.jpg'));
  image.naturalWidth = 300; image.naturalHeight = 450; image.emit('load'); await flush();
  assert(image.src.includes('/t_cover_big_2x/co1234.jpg'));
  image.emit('error'); await flush();
  assert.equal(image.src, game.image);
  image.naturalWidth = 1200; image.naturalHeight = 1800; image.emit('load');
  assert(image.classList.contains('loaded'));
  image.naturalWidth = 1200; image.naturalHeight = 720; image.emit('load'); await flush();
  assert.equal(descendants(app.ids.get('content'), node => node.tagName === 'img').length, 0);
});

test('Steam portraits stay first, followed by an exact catalogue cover when Steam fails', async () => {
  const app = await boot({ datasets: { games: [{ id: 'game', title: 'Game', steamId: 123, igdbCoverId: 'co1234' }] } });
  await app.navigate('games');
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  assert(image.src.endsWith('/123/library_600x900_2x.jpg'));
  image.emit('error'); await flush(); assert(image.src.endsWith('/123/library_600x900.jpg'));
  image.emit('error'); await flush(); assert(image.src.endsWith('/t_original/co1234.jpg'));
  image.emit('error'); await flush(); assert(image.src.endsWith('/t_cover_big_2x/co1234.jpg'));
});

test('books try ISBN-10, ISBN-13 and additional catalogues before an exact-ISBN metadata lookup', async () => {
  const book = { id: 'book', title: 'Test Book', creator: 'An Author', isbn: '0544272994' };
  for (const matching of [true, false]) {
    const app = await boot({ datasets: { books: [book] }, fetchMetadata: async url => ({ ok: true, json: async () =>
      url.includes('googleapis.com') ? { items: [{ volumeInfo: {
        industryIdentifiers: [{ identifier: matching ? '9780544272996' : '9788830106987' }],
        imageLinks: { thumbnail: 'http://example.test/verified-cover.jpg' }
      } }] } : { docs: [] }
    }) });
    const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
    assert(image.src.includes('/isbn/0544272994-L.jpg'));
    image.emit('error'); await flush(); assert(image.src.includes('/isbn/9780544272996-L.jpg'));
    image.emit('error'); await flush(); assert.equal(image.src, 'https://images-us.bookshop.org/ingram/9780544272996.jpg');
    image.emit('error'); await flush(); assert.equal(image.src, 'https://www.ibs.it/images/9780544272996_0_0_0_0_0.jpg');
    image.emit('error'); await flush();
    if (matching) assert.equal(image.src, 'https://example.test/verified-cover.jpg');
    else assert.equal(descendants(app.ids.get('content'), node => node.tagName === 'img').length, 0);
  }
});

test('book preferences are softer while other artwork minimums retain their boundaries', async () => {
  const app = await boot();
  const check = app.context.__app.meetsArtworkMinimum;
  assert(check({}, 'books', 250, 375));
  assert(!check({}, 'books', 249, 375));
  assert(!check({}, 'books', 250, 374));
  for (const kind of ['movies']) {
    assert(check({}, kind, 400, 600), kind);
    assert(!check({}, kind, 399, 600), kind);
    assert(!check({}, kind, 400, 599), kind);
    assert(!check({ imageFit: 'contain' }, kind, 300, 900), kind);
  }
  assert(check({}, 'bits', 400, 400));
  assert(!check({}, 'bits', 1200, 399));
  assert(check({ imageFit: 'contain' }, 'bits', 500, 180));
  assert(!check({ imageFit: 'contain' }, 'bits', 399, 180));
  assert(check({}, 'music', 400, 400));
  assert(!check({}, 'music', 399, 399));
  assert(!check({}, 'music', 800, 600));
  assert(check({}, 'games', 600, 800));
  assert(!check({}, 'games', 599, 800));
  assert(!check({}, 'games', 1200, 800));
});

test('low-resolution movie and article images advance to a sharper fallback', async () => {
  for (const kind of ['movies', 'bits']) {
    const entry = { id: 'one', title: 'One', image: 'https://example.test/small.jpg',
      imageFallbacks: ['https://example.test/sharp.jpg'] };
    const app = await boot({ datasets: { [kind]: [entry] } }); await app.navigate(kind);
    const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
    image.naturalWidth = 200; image.naturalHeight = 300; image.emit('load'); await flush();
    assert.equal(image.src, entry.imageFallbacks[0], kind);
    assert(!image.classList.contains('loaded'));
    image.naturalWidth = 400; image.naturalHeight = kind === 'bits' ? 400 : 600; image.emit('load');
    assert(image.classList.contains('loaded'), kind);
  }
});

test('a wide article illustration stays readable without a square-source requirement', async () => {
  const app = await boot({ datasets: { bits: [{ id: 'one', title: 'One', imageFit: 'contain', image: 'https://example.test/drawing.png' }] } });
  await app.navigate('bits');
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  image.naturalWidth = 600; image.naturalHeight = 220; image.emit('load');
  assert(image.classList.contains('loaded'));
});

test('books retain an undersized Google Books cover while probing a matching sharper edition', async () => {
  const metadata = async url => ({ ok: true, json: async () => url.includes('googleapis.com') ? { items: [{ volumeInfo: {
    industryIdentifiers: [{ identifier: '9780544272996' }],
    imageLinks: { thumbnail: 'https://books.google.com/books/content?id=book&img=1&zoom=1' }
  } }] } : { docs: [
    { title: 'Test Book', author_name: ['An Author'], cover_i: 100 },
    { title: 'Test Book', author_name: ['Different Person'], cover_i: 999 },
    { title: 'Test Book', author_name: ['An Author'], cover_i: 200 }
  ] } });
  const app = await boot({ datasets: { books: [{ id: 'book', title: 'Test Book', creator: 'An Author', isbn: '9780544272996' }] }, fetchMetadata: metadata });
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  for (let i = 0; i < 3; i++) { image.emit('error'); await flush(); }
  assert(new URL(image.src).searchParams.get('zoom') === '3');
  image.naturalWidth = 128; image.naturalHeight = 192; image.emit('load'); await flush();
  assert(image.classList.contains('loaded'));
  const savedURL = image.src;
  const probe = app.images.at(-1);
  assert.notEqual(probe, image);
  assert(new URL(probe.src).searchParams.get('zoom') === '2');
  for (let i = 0; i < 2; i++) {
    probe.naturalWidth = 128; probe.naturalHeight = 192; probe.emit('load'); await flush();
    assert.equal(image.src, savedURL, 'smaller cover remains visible during lookup');
  }
  assert(probe.src.includes('/id/100-L.jpg'));
  probe.naturalWidth = 80; probe.naturalHeight = 120; probe.emit('load'); await flush();
  assert(probe.src.includes('/id/200-L.jpg'));
  assert.equal(image.src, savedURL);
  probe.naturalWidth = 500; probe.naturalHeight = 750; probe.emit('load');
  assert(image.src.includes('/id/200-L.jpg'));
  assert(image.classList.contains('loaded'));
});

test('all existing book entries accept ordinary catalogue covers that the old filter discarded', async () => {
  const books = database.books.map(({ collectionId, ...book }) => book);
  const app = await boot({ datasets: { books } });
  const covers = descendants(app.ids.get('content'), node => node.tagName === 'img');
  assert.equal(covers.length, database.books.length);
  for (const image of covers) {
    assert(image.src);
    image.naturalWidth = 300; image.naturalHeight = 450; image.emit('load');
    assert(image.classList.contains('loaded'));
  }
  for (const id of ['the-song-of-achilles', 'reality-is-not-what-it-seems']) {
    const card = cardsOf(app).find(card => card.dataset.entryId === id);
    assert(card, id);
    assert(descendants(card, node => node.tagName === 'img')[0].classList.contains('loaded'), id);
  }
});

test('a working smaller book cover survives failed alternatives and unavailable metadata', async () => {
  const app = await boot({ datasets: { books: [{ id: 'book', title: 'Book', creator: 'Author',
    image: 'https://example.test/working.jpg', imageFallbacks: ['https://example.test/broken.jpg'], isbn: '9780544272996' }] } });
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  image.naturalWidth = 200; image.naturalHeight = 300; image.emit('load'); await flush();
  const probe = app.images.at(-1);
  assert.equal(probe.src, 'https://example.test/broken.jpg');
  assert(image.classList.contains('loaded'));
  const tried = new Set();
  for (let i = 0; i < 4; i++) {
    tried.add(probe.src); probe.emit('error'); await flush();
    assert.equal(image.src, 'https://example.test/working.jpg');
    assert(image.classList.contains('loaded'));
    assert(image.isConnected);
  }
  assert.equal(tried.size, 4);
  // A display load after an upgrade must not restart the candidate queue.
  image.emit('load'); await flush();
  assert.equal(image.src, 'https://example.test/working.jpg');
});

test('tiny book placeholders are skipped while a sharper source can still load', async () => {
  const app = await boot({ datasets: { books: [{ id: 'book', title: 'Book',
    image: 'https://example.test/blank.jpg', imageFallbacks: ['https://example.test/cover.jpg'] }] } });
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  image.naturalWidth = 1; image.naturalHeight = 1; image.emit('load'); await flush();
  assert.equal(image.src, 'https://example.test/cover.jpg');
  assert(!image.classList.contains('loaded'));
  image.naturalWidth = 328; image.naturalHeight = 499; image.emit('load');
  assert(image.classList.contains('loaded'));
});

test('book cover upgrades never replace a better working image with a smaller one', async () => {
  const app = await boot({ datasets: { books: [{ id: 'book', title: 'Book',
    image: 'https://example.test/best.jpg', imageFallbacks: ['https://example.test/smaller.jpg', 'https://example.test/sharp.jpg'] }] } });
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  image.naturalWidth = 240; image.naturalHeight = 360; image.emit('load'); await flush();
  const probe = app.images.at(-1);
  probe.naturalWidth = 128; probe.naturalHeight = 192; probe.emit('load'); await flush();
  assert.equal(image.src, 'https://example.test/best.jpg');
  assert.equal(probe.src, 'https://example.test/sharp.jpg');
  probe.naturalWidth = 600; probe.naturalHeight = 900; probe.emit('load');
  assert.equal(image.src, 'https://example.test/sharp.jpg');
  assert(image.classList.contains('loaded'));
  image.emit('load'); await flush();
  assert.equal(image.src, 'https://example.test/sharp.jpg');
});

test('movies request the medium poster and leave readable cards if every source is undersized', async () => {
  const app = await boot({ datasets: { movies: [{ id: 'tt0111161', title: 'The Shawshank Redemption' }] },
    fetchMetadata: async () => ({ ok: true, json: async () => ({ meta: { poster: 'https://images.metahub.space/poster/small/tt0111161/img' } }) }) });
  await app.navigate('movies');
  const image = descendants(app.ids.get('content'), node => node.tagName === 'img')[0];
  assert(image.src.includes('/poster/medium/'));
  image.naturalWidth = 250; image.naturalHeight = 375; image.emit('load'); await flush();
  assert.equal(descendants(app.ids.get('content'), node => node.tagName === 'img').length, 0);
  assert(app.ids.get('content').textContent.includes('The Shawshank Redemption'));
});

// Run with BASELINE_APP pointing to the accepted earlier app for an additional
// regression comparison. It is deliberately not required by the distributed repo.
if (process.env.BASELINE_APP) {
  test('movies retain every card, collection, cover and note when order is ignored', async () => {
    const old = await boot({ code: fs.readFileSync(process.env.BASELINE_APP, 'utf8') });
    const current = await boot();
    for (const kind of ['movies']) {
      await old.navigate(kind); await current.navigate(kind);
      const contents = app => {
        const cards = cardsOf(app).map(card => {
          if (!card.classList.contains('collection-card')) return snapshot(card);
          card.children[0].emit('click');
          const members = app.ids.get('dialog-books').children.map(snapshot).sort((a, b) => a.dataset.entryId.localeCompare(b.dataset.entryId));
          const shell = snapshot(card);
          // Chronological order intentionally changes the top three stack covers.
          shell.children[0].children[0].children = [];
          delete shell.children[0].children[0].dataset.layers;
          app.ids.get('collection-dialog').close();
          return { shell, members };
        });
        return cards.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      };
      assert.deepEqual(contents(current), contents(old), kind);
      assert.equal(current.ids.get('count').textContent, old.ids.get('count').textContent);
    }
  });
}
