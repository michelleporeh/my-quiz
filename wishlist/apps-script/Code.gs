/**
 * Chapter 26 wishlist backend (Google Apps Script).
 *
 * Paste this whole file into the Apps Script editor attached to a Google Sheet
 * (Extensions → Apps Script), run `setup` once, then deploy as a Web app
 * (Execute as: Me, Who has access: Anyone). See wishlist/SETUP.md.
 *
 * Data lives in two tabs of the Sheet:
 *   Items  – your wishlist (you can also edit it here by hand)
 *   Claims – which items guests have claimed. This is the "digging" spot:
 *            the site never shows it to you, but it's here if you look.
 */

const ITEM_HEADERS = ['id', 'name', 'link', 'store', 'price', 'rank', 'quantity', 'notes', 'image'];
const CLAIM_HEADERS = ['itemId', 'token', 'claimedAt'];

// ---------- one-time setup ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, 'Items', ITEM_HEADERS);
  const claims = ensureSheet_(ss, 'Claims', CLAIM_HEADERS);
  claims.hideSheet(); // out of sight, unless you go digging

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    const key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('ADMIN_KEY', key);
  }
  if (!props.getProperty('NOTIFY_EMAIL')) {
    props.setProperty('NOTIFY_EMAIL', Session.getEffectiveUser().getEmail());
  }
  Logger.log('Your admin key is: ' + props.getProperty('ADMIN_KEY'));
  Logger.log('Notifications go to: ' + props.getProperty('NOTIFY_EMAIL'));
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------- HTTP entry points ----------

function doGet(e) {
  // Public read: the wishlist plus how many of each item are claimed.
  return json_(publicList_());
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'Bad request' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    switch (body.action) {
      case 'claim':      return json_(claim_(body.itemId));
      case 'unclaim':    return json_(unclaim_(body.itemId, body.token));
      case 'adminList':  requireAdmin_(body); return json_({ items: readItems_() });
      case 'saveItem':   requireAdmin_(body); return json_(saveItem_(body.item));
      case 'deleteItem': requireAdmin_(body); return json_(deleteItem_(body.id));
      case 'move':       requireAdmin_(body); return json_(move_(body.id, body.direction));
      default:           return json_({ error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function requireAdmin_(body) {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key || body.key !== key) throw new Error('Wrong admin key');
}

// ---------- items ----------

function itemsSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Items'); }
function claimsSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Claims'); }

function readItems_() {
  const sh = itemsSheet_();
  const values = sh.getDataRange().getValues();
  const items = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row[0]) continue;
    const item = {};
    ITEM_HEADERS.forEach((h, i) => { item[h] = row[i]; });
    item.id = String(item.id);
    item.price = item.price === '' ? null : Number(item.price);
    item.rank = Number(item.rank) || 9999;
    item.quantity = Number(item.quantity) || 0; // 0 = no limit
    item._row = r + 1;
    items.push(item);
  }
  items.sort((a, b) => a.rank - b.rank);
  return items;
}

function writeItem_(item, row) {
  const sh = itemsSheet_();
  const values = ITEM_HEADERS.map(h => (item[h] === undefined || item[h] === null) ? '' : item[h]);
  if (row) sh.getRange(row, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
}

/** Renumber ranks 1..n in the given order. */
function renumber_(items) {
  const sh = itemsSheet_();
  items.forEach((it, i) => {
    it.rank = i + 1;
    sh.getRange(it._row, ITEM_HEADERS.indexOf('rank') + 1).setValue(it.rank);
  });
}

function saveItem_(input) {
  if (!input || !String(input.name || '').trim()) throw new Error('Name is required');
  const items = readItems_();
  const clean = {
    id: input.id ? String(input.id) : Utilities.getUuid().slice(0, 8),
    name: String(input.name).trim(),
    link: String(input.link || '').trim(),
    store: String(input.store || '').trim(),
    price: input.price === '' || input.price === null || input.price === undefined ? '' : Number(input.price),
    quantity: Math.max(0, parseInt(input.quantity, 10) || 0),
    notes: String(input.notes || '').trim(),
    image: String(input.image || '').trim(),
  };

  const existing = items.find(it => it.id === clean.id);
  const others = items.filter(it => it.id !== clean.id);
  let wanted = parseInt(input.rank, 10);
  if (!wanted || wanted < 1) wanted = existing ? existing.rank : others.length + 1;
  wanted = Math.min(wanted, others.length + 1);

  clean.rank = wanted;
  if (existing) {
    writeItem_(clean, existing._row);
    clean._row = existing._row;
  } else {
    writeItem_(clean, null);
    clean._row = itemsSheet_().getLastRow();
  }

  // Active ranking: slot this item in at its rank and shift everything else.
  others.splice(wanted - 1, 0, clean);
  renumber_(others);
  return { ok: true, items: readItems_() };
}

function deleteItem_(id) {
  const items = readItems_();
  const target = items.find(it => it.id === String(id));
  if (!target) throw new Error('Item not found');
  itemsSheet_().deleteRow(target._row);
  renumber_(readItems_());
  return { ok: true, items: readItems_() };
}

function move_(id, direction) {
  const items = readItems_();
  const i = items.findIndex(it => it.id === String(id));
  if (i < 0) throw new Error('Item not found');
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j >= 0 && j < items.length) {
    const tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    renumber_(items);
  }
  return { ok: true, items: readItems_() };
}

// ---------- claims ----------

function claimCounts_() {
  const values = claimsSheet_().getDataRange().getValues();
  const counts = {};
  for (let r = 1; r < values.length; r++) {
    const id = String(values[r][0]);
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function publicList_() {
  const counts = claimCounts_();
  const items = readItems_().map(it => {
    const out = Object.assign({}, it);
    delete out._row;
    out.claimed = counts[it.id] || 0;
    return out;
  });
  return { items };
}

function claim_(itemId) {
  const item = readItems_().find(it => it.id === String(itemId));
  if (!item) throw new Error('That item is no longer on the list');
  const claimed = claimCounts_()[item.id] || 0;
  if (item.quantity > 0 && claimed >= item.quantity) {
    return { error: 'Someone just claimed this one!', items: publicList_().items };
  }
  const token = Utilities.getUuid();
  claimsSheet_().appendRow([item.id, token, new Date()]);
  notify_();
  return { ok: true, token, items: publicList_().items };
}

function unclaim_(itemId, token) {
  const sh = claimsSheet_();
  const values = sh.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][0]) === String(itemId) && values[r][1] === token) {
      sh.deleteRow(r + 1);
      notify_();
      return { ok: true, items: publicList_().items };
    }
  }
  return { error: "Couldn't find your claim on this item", items: publicList_().items };
}

// ---------- email ----------

/**
 * Tells you *that* something changed, never *what*. At most one email per
 * 15 minutes so a burst of activity doesn't flood your inbox.
 */
function notify_() {
  const props = PropertiesService.getScriptProperties();
  const to = props.getProperty('NOTIFY_EMAIL');
  if (!to) return;
  const last = Number(props.getProperty('LAST_NOTIFIED') || 0);
  const now = Date.now();
  if (now - last < 15 * 60 * 1000) return;
  props.setProperty('LAST_NOTIFIED', String(now));
  MailApp.sendEmail({
    to: to,
    subject: 'Chapter 26 ✦ someone updated your wishlist',
    body: 'Someone just updated your wishlist. No spoilers — that is all you get to know. 🎂',
  });
}
