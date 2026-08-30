'use strict';

(() => {
  const MAX_MEDIA = 25 * 1024 * 1024;
  const INSTITUTIONS = [
    'ABBANK','Agribank','ANZ Việt Nam','Bac A Bank','BaoViet Bank','BIDV','BIDC','CAKE by VPBank','CB / VCBNeo','CIMB Việt Nam',
    'Co-opBank','DBS Bank Việt Nam','DongA Bank','Eximbank','GPBank','HDBank','HLBank','HSBC Việt Nam','Indovina Bank','KienlongBank',
    'LPBank','MB Bank','MSB','Nam A Bank','NCB','NongHyup Bank Hà Nội','OCB','OceanBank / MBV','PGBank','Public Bank Việt Nam',
    'PVcomBank','Sacombank','Saigonbank','SCB','SeABank','SHB','Shinhan Bank Việt Nam','Techcombank','TPBank','UOB Việt Nam',
    'VIB','VietABank','VietBank','Vietcombank','VietinBank','Vikki Bank','VPBank','Woori Bank Việt Nam','VRB','Timo','Ubank by VPBank',
    'MoMo','ZaloPay','Viettel Money','VNPT Money','ShopeePay','Tiền mặt','Khác'
  ];

  let state = null;
  let persistQueue = Promise.resolve();

  class APIError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
  }

  const nowISO = () => new Date().toISOString();
  const cleanText = (v, max = 500) => String(v ?? '').replace(/\0/g, '').trim().slice(0, max);
  const cleanLong = (v, max = 200000) => String(v ?? '').replace(/\0/g, '').slice(0, max);
  const dateISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
  const monthKey = v => /^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : null;
  const num = (v, { min = 0, max = 1e15 } = {}) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return Math.round(n);
  };
  const clone = v => typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

  function defaultState(displayName = 'Prix') {
    return {
      version: 5,
      settings: {
        displayName: cleanText(displayName, 60) || 'Prix',
        currency: 'VND', privacy: false, evening: false, autoLockMinutes: 15,
        createdAt: nowISO()
      },
      monthPlans: {},
      accounts: [
        { id: crypto.randomUUID(), name: 'Tiền mặt', institution: 'Tiền mặt', openingBalance: 0, archived: false },
        { id: crypto.randomUUID(), name: 'Vietcombank', institution: 'Vietcombank', openingBalance: 0, archived: false },
        { id: crypto.randomUUID(), name: 'MoMo', institution: 'MoMo', openingBalance: 0, archived: false }
      ],
      transactions: [], budgets: [], dailyEntries: [], privateEntries: [], goals: [], media: []
    };
  }

  function normalizeState(input) {
    const base = defaultState(input?.settings?.displayName || 'Prix');
    const out = { ...base, ...(input && typeof input === 'object' ? input : {}) };
    out.version = 5;
    out.settings = { ...base.settings, ...(input?.settings || {}) };
    for (const key of ['accounts','transactions','budgets','dailyEntries','privateEntries','goals','media']) {
      if (!Array.isArray(out[key])) out[key] = [];
    }
    if (!out.monthPlans || typeof out.monthPlans !== 'object' || Array.isArray(out.monthPlans)) out.monthPlans = {};
    return out;
  }

  function getAccount(id) { return state?.accounts?.find(a => a.id === id); }
  function accountBalance(id) {
    const a = getAccount(id); if (!a) return 0;
    let balance = Number(a.openingBalance) || 0;
    for (const t of state.transactions) {
      if (t.type === 'expense' && t.accountId === id) balance -= t.amount;
      if (t.type === 'income' && t.accountId === id) balance += t.amount;
      if (t.type === 'transfer') {
        if (t.accountId === id) balance -= t.amount;
        if (t.toAccountId === id) balance += t.amount;
      }
    }
    return balance;
  }
  function computedState() {
    const safe = clone(state);
    safe.accounts = safe.accounts.map(a => ({ ...a, balance: accountBalance(a.id) }));
    return safe;
  }

  function sanitizeTransaction(body, id = null) {
    const type = ['expense','income','transfer'].includes(body.type) ? body.type : null;
    const amount = num(body.amount, { min: 1, max: 1e15 });
    const date = dateISO(body.date);
    const accountId = cleanText(body.accountId, 80);
    const toAccountId = cleanText(body.toAccountId, 80);
    if (!type || !amount || !date || !getAccount(accountId)) throw new APIError('Giao dịch không hợp lệ.');
    if (type === 'transfer' && (!getAccount(toAccountId) || toAccountId === accountId)) throw new APIError('Tài khoản nhận không hợp lệ.');
    return {
      id: id || crypto.randomUUID(), type, amount, date,
      category: cleanText(body.category, 80) || (type === 'income' ? 'Thu nhập' : type === 'transfer' ? 'Chuyển tiền' : 'Khác'),
      accountId, toAccountId: type === 'transfer' ? toAccountId : null,
      note: cleanLong(body.note, 2000), addToMonth: type === 'income' ? Boolean(body.addToMonth) : false,
      createdAt: body.createdAt || nowISO(), updatedAt: nowISO()
    };
  }

  async function persistSnapshot(snapshot) {
    const json = JSON.stringify(snapshot);
    const task = persistQueue.catch(() => {}).then(() => NativeBridge.call('saveState', { json }));
    persistQueue = task.catch(() => {});
    return task;
  }

  async function mutate(fn) {
    const before = clone(state);
    try {
      const result = fn();
      await persistSnapshot(state);
      return result;
    } catch (err) {
      state = before;
      throw err;
    }
  }

  async function ensureLoaded() {
    if (state) return;
    const raw = await NativeBridge.call('loadState');
    if (raw?.json) state = normalizeState(JSON.parse(raw.json));
    else {
      state = defaultState();
      await persistSnapshot(state);
    }
  }

  function parseBody(init = {}) {
    if (init.body == null || init.body === '') return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch { throw new APIError('JSON không hợp lệ.'); }
    }
    return init.body;
  }

  function header(init, name) {
    const h = init?.headers;
    if (!h) return '';
    if (typeof h.get === 'function') return h.get(name) || '';
    const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? String(h[key]) : '';
  }

  function jsonResponse(status, payload) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  function noContent() { return new Response(null, { status: 204 }); }

  async function handle(path, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    const url = new URL(path, 'https://local.sorelax.invalid');
    const p = url.pathname;

    if (method === 'GET' && p === '/api/status') {
      const native = await NativeBridge.call('status');
      return { status: 200, body: { ok: true, setupRequired: !native.configured, authenticated: native.unlocked, csrf: 'local', native } };
    }

    if (method === 'POST' && p === '/api/setup') {
      const body = parseBody(init);
      const password = String(body.password || '');
      if (password.length < 10 || password.length > 256) throw new APIError('Mật khẩu cần từ 10 ký tự.');
      const name = cleanText(body.name, 60) || 'Prix';
      state = defaultState(name);
      try { await NativeBridge.call('setup', { password, json: JSON.stringify(state) }); }
      catch (err) { state = null; throw err; }
      return { status: 200, body: { ok: true, csrf: 'local' } };
    }

    if (method === 'POST' && p === '/api/login') {
      const body = parseBody(init);
      await NativeBridge.call('unlock', { password: String(body.password || '') });
      state = null;
      await ensureLoaded();
      return { status: 200, body: { ok: true, csrf: 'local' } };
    }

    if (method === 'POST' && p === '/api/logout') {
      state = null;
      await NativeBridge.call('lock');
      return { status: 200, body: { ok: true } };
    }

    const native = await NativeBridge.call('status');
    if (!native.unlocked) throw new APIError('Sổ đang khóa.', 401);
    await ensureLoaded();

    if (method === 'GET' && p === '/api/data') return { status: 200, body: { ok: true, data: computedState(), csrf: 'local' } };
    if (method === 'GET' && p === '/api/institutions') return { status: 200, body: { ok: true, data: INSTITUTIONS } };

    const body = (method === 'POST' && p === '/api/media') ? null : parseBody(init);

    if (method === 'PUT' && p === '/api/month-plan') {
      const month = monthKey(body.month), total = num(body.total, { min: 0, max: 1e15 });
      if (!month || total === null) throw new APIError('Tổng tiền tháng không hợp lệ.');
      const data = await mutate(() => (state.monthPlans[month] = { total, updatedAt: nowISO() }));
      return { status: 200, body: { ok: true, data } };
    }

    if (method === 'POST' && p === '/api/transactions') {
      const value = sanitizeTransaction(body);
      await mutate(() => state.transactions.push(value));
      return { status: 201, body: { ok: true, data: value } };
    }

    if ((method === 'PUT' || method === 'DELETE') && p.startsWith('/api/transactions/')) {
      const id = cleanText(p.slice('/api/transactions/'.length), 100);
      const i = state.transactions.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy giao dịch.', 404);
      if (method === 'DELETE') { await mutate(() => state.transactions.splice(i, 1)); return { status: 204 }; }
      const value = sanitizeTransaction(body, id); value.createdAt = state.transactions[i].createdAt;
      await mutate(() => { state.transactions[i] = value; });
      return { status: 200, body: { ok: true, data: value } };
    }

    if (method === 'POST' && p === '/api/accounts') {
      const name = cleanText(body.name, 80), institution = cleanText(body.institution, 120), openingBalance = num(body.openingBalance, { min: -1e15, max: 1e15 });
      if (!name || openingBalance === null) throw new APIError('Tài khoản không hợp lệ.');
      const a = { id: crypto.randomUUID(), name, institution: institution || name, openingBalance, archived: false, createdAt: nowISO() };
      await mutate(() => state.accounts.push(a));
      return { status: 201, body: { ok: true, data: a } };
    }

    if ((method === 'PUT' || method === 'DELETE') && p.startsWith('/api/accounts/')) {
      const id = cleanText(p.slice('/api/accounts/'.length), 100), i = state.accounts.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy tài khoản.', 404);
      if (method === 'DELETE') {
        if (state.transactions.some(t => t.accountId === id || t.toAccountId === id)) throw new APIError('Tài khoản đã có giao dịch. Hãy lưu trữ thay vì xóa.', 409);
        await mutate(() => state.accounts.splice(i, 1)); return { status: 204 };
      }
      const result = await mutate(() => {
        const a = state.accounts[i];
        a.name = cleanText(body.name, 80) || a.name;
        a.institution = cleanText(body.institution, 120) || a.institution;
        const ob = num(body.openingBalance, { min: -1e15, max: 1e15 }); if (ob !== null) a.openingBalance = ob;
        a.archived = Boolean(body.archived); a.updatedAt = nowISO(); return clone(a);
      });
      return { status: 200, body: { ok: true, data: result } };
    }

    if (method === 'POST' && p === '/api/budgets') {
      const month = monthKey(body.month), limit = num(body.limit, { min: 1, max: 1e15 }), category = cleanText(body.category, 80);
      if (!month || !limit || !category) throw new APIError('Ngân sách không hợp lệ.');
      if (state.budgets.some(x => x.month === month && x.category.toLowerCase() === category.toLowerCase())) throw new APIError('Danh mục này đã có ngân sách trong tháng.', 409);
      const b = { id: crypto.randomUUID(), month, category, limit, createdAt: nowISO() };
      await mutate(() => state.budgets.push(b));
      return { status: 201, body: { ok: true, data: b } };
    }

    if ((method === 'PUT' || method === 'DELETE') && p.startsWith('/api/budgets/')) {
      const id = cleanText(p.slice('/api/budgets/'.length), 100), i = state.budgets.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy ngân sách.', 404);
      if (method === 'DELETE') { await mutate(() => state.budgets.splice(i, 1)); return { status: 204 }; }
      const limit = num(body.limit, { min: 1, max: 1e15 }), category = cleanText(body.category, 80), month = monthKey(body.month);
      if (!limit || !category || !month) throw new APIError('Ngân sách không hợp lệ.');
      const data = await mutate(() => (state.budgets[i] = { ...state.budgets[i], limit, category, month, updatedAt: nowISO() }));
      return { status: 200, body: { ok: true, data } };
    }


    if (method === 'POST' && p === '/api/journal') {
      const date = dateISO(body.date); if (!date) throw new APIError('Ngày không hợp lệ.');
      const mediaIds = Array.isArray(body.mediaIds) ? [...new Set(body.mediaIds.map(x => cleanText(x, 100)).filter(id => state.media.some(m => m.id === id)))] : [];
      const entry = {
        id: crypto.randomUUID(), date,
        title: cleanText(body.title, 200), body: cleanLong(body.body, 100000), mood: cleanText(body.mood, 40),
        mediaIds, tags: Array.isArray(body.tags) ? body.tags.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 50) : [],
        createdAt: nowISO(), updatedAt: nowISO()
      };
      await mutate(() => state.dailyEntries.push(entry));
      return { status: 201, body: { ok: true, data: entry } };
    }

    if ((method === 'PUT' || method === 'DELETE') && p.startsWith('/api/journal/')) {
      const id = cleanText(p.slice('/api/journal/'.length), 100);
      const i = state.dailyEntries.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy bài nhật ký.', 404);
      if (method === 'DELETE') { await mutate(() => state.dailyEntries.splice(i, 1)); return { status: 204 }; }
      const date = dateISO(body.date); if (!date) throw new APIError('Ngày không hợp lệ.');
      const mediaIds = Array.isArray(body.mediaIds) ? [...new Set(body.mediaIds.map(x => cleanText(x, 100)).filter(mid => state.media.some(m => m.id === mid)))] : [];
      const data = await mutate(() => {
        const e = state.dailyEntries[i];
        e.date = date; e.title = cleanText(body.title, 200); e.body = cleanLong(body.body, 100000);
        e.mood = cleanText(body.mood, 40); e.mediaIds = mediaIds;
        e.tags = Array.isArray(body.tags) ? body.tags.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 50) : [];
        e.updatedAt = nowISO(); return clone(e);
      });
      return { status: 200, body: { ok: true, data } };
    }

    if (method === 'PUT' && p === '/api/daily') {
      const date = dateISO(body.date); if (!date) throw new APIError('Ngày không hợp lệ.');
      const mediaIds = Array.isArray(body.mediaIds) ? [...new Set(body.mediaIds.map(x => cleanText(x, 100)).filter(id => state.media.some(m => m.id === id)))] : [];
      const v = { date, title: cleanText(body.title, 200), body: cleanLong(body.body, 100000), mood: cleanText(body.mood, 40), mediaIds, tags: Array.isArray(body.tags) ? body.tags.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 50) : [], updatedAt: nowISO() };
      const data = await mutate(() => {
        let e = state.dailyEntries.find(x => x.date === date);
        if (e) Object.assign(e, v); else { e = { id: crypto.randomUUID(), createdAt: nowISO(), ...v }; state.dailyEntries.push(e); }
        return clone(e);
      });
      return { status: 200, body: { ok: true, data } };
    }

    if (method === 'DELETE' && p.startsWith('/api/daily/')) {
      const date = decodeURIComponent(p.slice('/api/daily/'.length)); const i = state.dailyEntries.findIndex(x => x.date === date);
      if (i < 0) throw new APIError('Không tìm thấy nhật ký.', 404);
      await mutate(() => state.dailyEntries.splice(i, 1)); return { status: 204 };
    }

    if (method === 'POST' && p === '/api/media') {
      const mime = cleanText(header(init, 'content-type'), 100).toLowerCase();
      if (!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(mime)) throw new APIError('Chỉ hỗ trợ JPEG, PNG, WebP, GIF hoặc AVIF.', 415);
      const blob = init.body;
      if (!blob || typeof blob.arrayBuffer !== 'function') throw new APIError('Ảnh rỗng hoặc không hợp lệ.');
      if (blob.size > MAX_MEDIA) throw new APIError('Mỗi ảnh tối đa 25 MB.', 413);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length < 16) throw new APIError('Ảnh rỗng hoặc không hợp lệ.');
      const id = crypto.randomUUID();
      const m = { id, mime, size: bytes.length, name: decodeURIComponent(cleanText(header(init, 'x-file-name'), 160) || 'ảnh'), createdAt: nowISO() };
      const base64 = bytesToBase64(bytes);
      await NativeBridge.call('saveMedia', { id, mime, base64 });
      try { await mutate(() => state.media.push(m)); }
      catch (err) { await NativeBridge.call('deleteMedia', { id }).catch(() => {}); throw err; }
      return { status: 201, body: { ok: true, data: m } };
    }

    if (method === 'DELETE' && p.startsWith('/api/media/')) {
      const id = cleanText(p.slice('/api/media/'.length), 100), i = state.media.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy ảnh.', 404);
      if (state.dailyEntries.some(e => Array.isArray(e.mediaIds) && e.mediaIds.includes(id))) throw new APIError('Ảnh đang được dùng trong nhật ký.', 409);
      await mutate(() => state.media.splice(i, 1));
      await NativeBridge.call('deleteMedia', { id }).catch(() => {});
      return { status: 204 };
    }

    if (method === 'POST' && p === '/api/private') {
      const e = { id: crypto.randomUUID(), title: cleanText(body.title, 300) || 'Trang chưa đặt tên', body: cleanLong(body.body, 200000), createdAt: nowISO(), updatedAt: nowISO() };
      await mutate(() => state.privateEntries.unshift(e));
      return { status: 201, body: { ok: true, data: e } };
    }

    if ((method === 'PUT' || method === 'DELETE') && p.startsWith('/api/private/')) {
      const id = cleanText(p.slice('/api/private/'.length), 100), i = state.privateEntries.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy trang.', 404);
      if (method === 'DELETE') { await mutate(() => state.privateEntries.splice(i, 1)); return { status: 204 }; }
      const data = await mutate(() => {
        const e = state.privateEntries[i]; e.title = cleanText(body.title, 300) || 'Trang chưa đặt tên'; e.body = cleanLong(body.body, 200000); e.updatedAt = nowISO(); return clone(e);
      });
      return { status: 200, body: { ok: true, data } };
    }

    if (method === 'POST' && p === '/api/goals') {
      const name = cleanText(body.name, 120), target = num(body.target, { min: 1, max: 1e15 }), current = num(body.current, { min: 0, max: 1e15 });
      if (!name || !target || current === null) throw new APIError('Mục tiêu không hợp lệ.');
      const g = { id: crypto.randomUUID(), name, target, current, deadline: dateISO(body.deadline) || '', note: cleanLong(body.note, 1000), createdAt: nowISO() };
      await mutate(() => state.goals.push(g));
      return { status: 201, body: { ok: true, data: g } };
    }

    if ((method === 'PUT' || method === 'DELETE') && p.startsWith('/api/goals/')) {
      const id = cleanText(p.slice('/api/goals/'.length), 100), i = state.goals.findIndex(x => x.id === id);
      if (i < 0) throw new APIError('Không tìm thấy mục tiêu.', 404);
      if (method === 'DELETE') { await mutate(() => state.goals.splice(i, 1)); return { status: 204 }; }
      const target = num(body.target, { min: 1, max: 1e15 }), current = num(body.current, { min: 0, max: 1e15 }), name = cleanText(body.name, 120);
      if (!name || !target || current === null) throw new APIError('Mục tiêu không hợp lệ.');
      const data = await mutate(() => (state.goals[i] = { ...state.goals[i], name, target, current, deadline: dateISO(body.deadline) || '', note: cleanLong(body.note, 1000), updatedAt: nowISO() }));
      return { status: 200, body: { ok: true, data } };
    }

    if (method === 'PUT' && p === '/api/settings') {
      const data = await mutate(() => {
        if (body.displayName !== undefined) state.settings.displayName = cleanText(body.displayName, 60) || state.settings.displayName;
        if (body.privacy !== undefined) state.settings.privacy = Boolean(body.privacy);
        if (body.evening !== undefined) state.settings.evening = Boolean(body.evening);
        if (body.autoLockMinutes !== undefined) { const n = num(body.autoLockMinutes, { min: 1, max: 720 }); if (n !== null) state.settings.autoLockMinutes = n; }
        return clone(state.settings);
      });
      return { status: 200, body: { ok: true, data } };
    }

    if (method === 'POST' && p === '/api/password') {
      if (String(body.next || '').length < 10 || String(body.next || '').length > 256) throw new APIError('Mật khẩu mới cần từ 10 ký tự.');
      await NativeBridge.call('changePassword', { current: String(body.current || ''), next: String(body.next || '') });
      return { status: 200, body: { ok: true } };
    }

    throw new APIError('API không tồn tại.', 404);
  }

  async function localFetch(input, init = {}) {
    const path = typeof input === 'string' ? input : input?.url;
    try {
      const result = await handle(path, init);
      if (result.status === 204) return noContent();
      return jsonResponse(result.status || 200, result.body ?? { ok: true });
    } catch (err) {
      const status = err instanceof APIError ? err.status : 500;
      return jsonResponse(status, { ok: false, error: err?.message || 'Có lỗi xảy ra.' });
    }
  }

  function bytesToBase64(bytes) {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(out);
  }

  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.startsWith('/api/')) return localFetch(input, init);
    return realFetch(input, init);
  };

  globalThis.LocalAPI = Object.freeze({
    mediaURL: id => `sorelax-media://media/${encodeURIComponent(id)}`,
    async exportBackup(password) { return NativeBridge.call('exportBackup', { password }); },
    async restoreBackup(password) {
      const result = await NativeBridge.call('restoreBackupPicker', { password });
      state = null; await ensureLoaded(); return result;
    },
    async pickPhotos(maxSelection = 8) {
      const result = await NativeBridge.call('pickPhotos', { maxSelection: Math.max(1, Math.min(12, Number(maxSelection) || 8)) });
      const items = Array.isArray(result?.items) ? result.items : [];
      if (items.length) {
        try {
          await mutate(() => {
            for (const item of items) if (item?.id && !state.media.some(m => m.id === item.id)) state.media.push(item);
          });
        } catch (err) {
          await Promise.all(items.map(item => item?.id ? NativeBridge.call('deleteMedia', { id: item.id }).catch(() => {}) : null));
          throw err;
        }
      }
      return items;
    },
    async unlockBiometric() { await NativeBridge.call('unlockBiometric'); state = null; await ensureLoaded(); },
    async setBiometric(enabled) { return NativeBridge.call('setBiometric', { enabled: Boolean(enabled) }); },
    async status() { return NativeBridge.call('status'); }
  });
})();
