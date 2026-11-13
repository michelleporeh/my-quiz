// Talks to the Apps Script backend, or to a local mock in preview mode.
(function () {
  const URL_ = window.WISHLIST_API_URL;
  const PREVIEW = !URL_;

  function safeGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ---------- real backend ----------
  async function get() {
    const res = await fetch(URL_, { method: 'GET' });
    return check(await res.json());
  }
  async function post(body) {
    // text/plain avoids a CORS preflight, which Apps Script can't answer.
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return check(await res.json());
  }
  function check(data) {
    if (data && data.error) {
      const err = new Error(data.error);
      err.items = data.items;
      throw err;
    }
    return data;
  }

  // ---------- preview-mode mock (mirrors Code.gs) ----------
  const MOCK_KEY = 'wishlist-preview-db';
  const SAMPLE = {
    items: [
      { id: 'a1', name: 'Le Creuset Dutch oven', store: 'Le Creuset', link: 'https://example.com', price: 350, rank: 1, quantity: 1, notes: 'Any shade of green', image: '' },
      { id: 'a2', name: 'Pottery class for two', store: 'Local studio', link: '', price: 120, rank: 2, quantity: 1, notes: '', image: '' },
      { id: 'a3', name: 'Beeswax taper candles', store: '', link: '', price: 18, rank: 3, quantity: 0, notes: 'As many as you like', image: '' },
      { id: 'a4', name: 'Linen napkins (set of 4)', store: 'Hawkins', link: 'https://example.com', price: 48, rank: 4, quantity: 2, notes: 'Natural or rust', image: '' },
    ],
    claims: [],
  };
  function db() { return safeGet(MOCK_KEY, null) || JSON.parse(JSON.stringify(SAMPLE)); }
  function save(d) { safeSet(MOCK_KEY, d); }
  function sorted(items) { return items.slice().sort((a, b) => a.rank - b.rank); }
  function pub(d) {
    return sorted(d.items).map(it => ({ ...it, claimed: d.claims.filter(c => c.itemId === it.id).length }));
  }
  function renumber(items) { items.forEach((it, i) => { it.rank = i + 1; }); return items; }

  const mock = {
    list() { return { items: pub(db()) }; },
    claim(itemId) {
      const d = db();
      const item = d.items.find(i => i.id === itemId);
      if (!item) throw new Error('That item is no longer on the list');
      const n = d.claims.filter(c => c.itemId === itemId).length;
      if (item.quantity > 0 && n >= item.quantity) {
        const e = new Error('Someone just claimed this one!'); e.items = pub(d); throw e;
      }
      const token = Math.random().toString(36).slice(2);
      d.claims.push({ itemId, token });
      save(d);
      return { ok: true, token, items: pub(d) };
    },
    unclaim(itemId, token) {
      const d = db();
      const i = d.claims.findIndex(c => c.itemId === itemId && c.token === token);
      if (i < 0) { const e = new Error("Couldn't find your claim on this item"); e.items = pub(d); throw e; }
      d.claims.splice(i, 1);
      save(d);
      return { ok: true, items: pub(d) };
    },
    adminList() { return { items: sorted(db().items) }; },
    saveItem(input) {
      if (!String(input.name || '').trim()) throw new Error('Name is required');
      const d = db();
      const items = sorted(d.items);
      const existing = items.find(i => i.id === input.id);
      const others = items.filter(i => i.id !== input.id);
      const clean = {
        id: input.id || Math.random().toString(36).slice(2, 10),
        name: input.name.trim(), link: (input.link || '').trim(), store: (input.store || '').trim(),
        price: input.price === '' || input.price == null ? null : Number(input.price),
        quantity: Math.max(0, parseInt(input.quantity, 10) || 0),
        notes: (input.notes || '').trim(), image: (input.image || '').trim(),
      };
      let wanted = parseInt(input.rank, 10);
      if (!wanted || wanted < 1) wanted = existing ? existing.rank : others.length + 1;
      wanted = Math.min(wanted, others.length + 1);
      others.splice(wanted - 1, 0, clean);
      d.items = renumber(others);
      save(d);
      return { ok: true, items: d.items };
    },
    deleteItem(id) {
      const d = db();
      d.items = renumber(sorted(d.items).filter(i => i.id !== id));
      d.claims = d.claims.filter(c => c.itemId !== id);
      save(d);
      return { ok: true, items: d.items };
    },
    move(id, dir) {
      const d = db();
      const items = sorted(d.items);
      const i = items.findIndex(x => x.id === id);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < items.length) [items[i], items[j]] = [items[j], items[i]];
      d.items = renumber(items);
      save(d);
      return { ok: true, items: d.items };
    },
  };
  const delay = (v) => new Promise((res, rej) => setTimeout(() => {
    try { res(v()); } catch (e) { rej(e); }
  }, 250));

  window.WishlistAPI = {
    preview: PREVIEW,
    list: () => PREVIEW ? delay(() => mock.list()) : get(),
    claim: (itemId) => PREVIEW ? delay(() => mock.claim(itemId)) : post({ action: 'claim', itemId }),
    unclaim: (itemId, token) => PREVIEW ? delay(() => mock.unclaim(itemId, token)) : post({ action: 'unclaim', itemId, token }),
    adminList: (key) => PREVIEW ? delay(() => mock.adminList()) : post({ action: 'adminList', key }),
    saveItem: (key, item) => PREVIEW ? delay(() => mock.saveItem(item)) : post({ action: 'saveItem', key, item }),
    deleteItem: (key, id) => PREVIEW ? delay(() => mock.deleteItem(id)) : post({ action: 'deleteItem', key, id }),
    move: (key, id, direction) => PREVIEW ? delay(() => mock.move(id, direction)) : post({ action: 'move', key, id, direction }),
    store: { get: safeGet, set: safeSet },
  };
})();
