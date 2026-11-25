'use strict';
/* Общие записи на всех устройствах: личная база Supabase, вход по почте и паролю.
   Ключ ниже публичный: без входа он не открывает ни одной записи (правила доступа стоят в самой базе). */
const Sync = (() => {
  const URL_ = 'https://encpauvtfctzxtjkhgyi.supabase.co', KEY_ = 'sb_publishable_B6JevZAysqE4RdcGN9t-RQ_-CoukiOJ', AUTH = 'kab.auth';
  const docs = {}, dirty = new Set(), CB = new Set();
  let state = 'off', err = '', timer = null, running = false, again = false, lastPull = 0;
  const embedded = (() => { try { return window.top !== window; } catch (e) { return true; } })();
  const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v);
  const eq = (a, b) => (a === undefined) === (b === undefined) && canon(a) === canon(b), copy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const isO = v => !!v && typeof v === 'object' && !Array.isArray(v), hasId = a => Array.isArray(a) && a.every(x => isO(x) && x.id != null);
  /* трёхстороннее слияние: base – что было при прошлой синхронизации */
  function merge(base, mine, theirs) {
    if (eq(mine, theirs)) return copy(mine);
    if (base !== undefined && eq(mine, base)) return copy(theirs);
    if (base !== undefined && eq(theirs, base)) return copy(mine);
    if (isO(mine) && isO(theirs)) {
      const b = isO(base) ? base : {}, o = {};
      for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
        if (k === '__proto__') continue;
        const v = part(b[k], mine[k], theirs[k]);
        if (v !== undefined) o[k] = v;
      }
      return o;
    }
    if (hasId(mine) && hasId(theirs) && (mine.length || theirs.length)) {
      const M = a => new Map((hasId(a) ? a : []).map(x => [String(x.id), x])), B = M(base), L = M(mine), R = M(theirs), out = [];
      for (const id of new Set([...R.keys(), ...L.keys()])) { const v = part(B.get(id), L.get(id), R.get(id)); if (v !== undefined) out.push(v); }
      return out;
    }
    return copy(mine === undefined ? theirs : mine);
  }
  function part(b, l, r) {
    if (l === undefined && r === undefined) return undefined;
    if (l === undefined) return b !== undefined && eq(r, b) ? undefined : copy(r);   // удалено здесь и не менялось там
    if (r === undefined) return b !== undefined && eq(l, b) ? undefined : copy(l);   // удалено там и не менялось здесь
    return merge(b, l, r);
  }
  /* прошлое состояние лежит в IndexedDB, чтобы не занимать место записей */
  let dbp;
  const db = () => dbp ||= new Promise((ok, no) => { const r = indexedDB.open('kab-sync', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const kv = (mode, fn) => db().then(d => new Promise((ok, no) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => ok(q && q.result); t.onerror = t.onabort = () => no(t.error); }));
  const getBase = k => kv('readonly', s => s.get(k)), setBase = (k, v) => kv('readwrite', s => s.put(v, k));
  const auth = () => { try { const a = JSON.parse(localStorage.getItem(AUTH)); return a && a.refresh ? a : null; } catch (e) { return null; } };
  function set(st, e = '') { state = st; err = e; CB.forEach(f => { try { f(); } catch (x) {} }); }
  function keep(j) { const a = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user?.id || '', email: j.user?.email || '' }; localStorage.setItem(AUTH, JSON.stringify(a)); return a; }
  async function call(path, opt = {}, token) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 25000);
    try { return await fetch(URL_ + path, { ...opt, signal: c.signal, cache: 'no-store', headers: { apikey: KEY_, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...opt.headers } }); }
    finally { clearTimeout(t); }
  }
  async function token() {
    const a = auth();
    if (!a) throw new Error('signedout');
    if (a.exp - Date.now() > 90000) return a.access;
    const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: a.refresh }) });
    if (r.status >= 400 && r.status < 500 && r.status !== 429) { localStorage.removeItem(AUTH); throw new Error('expired'); }
    if (!r.ok) throw new Error('net');
    return keep(await r.json()).access;
  }
  async function rest(q, opt, t) {
    const r = await call('/rest/v1/docs' + q, opt, t);
    if (r.status === 409) return { conflict: true };
    if (!r.ok) throw new Error('db' + r.status);
    const x = await r.text();
    return x ? JSON.parse(x) : [];
  }
  const rep = { headers: { Prefer: 'return=representation' } };
  async function one(name, t, uid) {
    const D = docs[name], bk = uid + ':' + name;
    for (let n = 0; n < 5; n++) {
      const row = (await rest(`?key=eq.${name}&select=data`, {}, t))[0], remote = row?.data?.d, rv = row?.data?.v;
      if (D.ready && !D.ready()) { again = true; return; }
      const base = await getBase(bk);
      if (D.ready && !D.ready()) { again = true; return; }
      const local = D.get();
      if (remote !== undefined && D.max && remote.v > D.max) throw new Error('old');
      let next;
      if (remote === undefined) { if (local == null) return; next = copy(local); }
      else if (local == null) next = copy(remote);
      else if (base === undefined) {
        if (eq(local, remote)) next = copy(remote);
        else { const how = D.first ? D.choice : 'merge'; if (!how) { set('choose'); throw new Error('choose'); } next = how === 'cloud' ? copy(remote) : how === 'mine' ? copy(local) : merge(undefined, remote, local); }
        if (D.choice === 'cloud') D.backup?.();
      } else next = merge(base, local, remote);
      if (remote !== undefined && eq(next, remote)) {
        if (!eq(next, local)) D.apply(next);
        D.choice = null; await setBase(bk, next); return;
      }
      const v = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random(), body = { key: name, data: { v, d: next }, updated_at: new Date().toISOString() };
      const before = canon(local);
      const res = row ? await rest(`?key=eq.${name}&data->>v=eq.${encodeURIComponent(rv)}`, { method: 'PATCH', body: JSON.stringify(body), ...rep }, t) : await rest('', { method: 'POST', body: JSON.stringify(body), ...rep }, t);
      if (res.conflict || !res.length) continue;                      // другое устройство успело раньше
      const now = D.get();
      if (now != null && canon(now) !== before) {                     // пока отправляли, здесь появилось новое
        if (!(D.ready && !D.ready())) D.apply(merge(local ?? {}, now, next)); else { await setBase(bk, local ?? next); D.choice = null; again = true; return; }
        again = true;
      } else if (!eq(next, local)) { if (D.ready && !D.ready()) { again = true; if (local != null) await setBase(bk, local); D.choice = null; return; } D.apply(next); }
      D.choice = null; await setBase(bk, next); return;
    }
    again = true;
  }
  const lock = fn => navigator.locks ? navigator.locks.request('kab-sync', fn) : fn();
  async function run() {
    if (embedded || !auth()) return;
    if (running) { again = true; return; }
    running = true; again = false; clearTimeout(timer); timer = null; set('busy');
    try {
      await lock(async () => { const t = await token(), uid = auth().uid; for (const n in docs) { dirty.delete(n); try { await one(n, t, uid); } catch (e) { dirty.add(n); throw e; } } });
      lastPull = Date.now(); set('ok');
    } catch (e) {
      const m = String(e?.message);
      if (m === 'choose') set('choose'); else if (m === 'expired' || m === 'signedout') set('off', m === 'expired' ? 'Вход устарел, войди ещё раз' : ''); else if (m === 'old') set('err', 'На другом устройстве версия новее: обнови страницу'); else if (/^db4/.test(m)) set('err', 'База не приняла записи (' + m + ')'); else set('err', 'Нет связи, записи сохранены здесь');
    }
    running = false;
    if (state === 'err') plan(30000); else if (again && state === 'ok') plan(1500);
  }
  function plan(ms) { if (embedded || !auth()) return; clearTimeout(timer); timer = setTimeout(run, ms); }
  return {
    add(name, d) { docs[name] = d; }, merge, canon, embedded, run,
    touch(name) { if (embedded) return; dirty.add(name); if (state !== 'choose') plan(1500); },
    on(f) { CB.add(f); }, get state() { return state; }, get error() { return err; }, get email() { return auth()?.email || ''; }, get signed() { return !!auth(); },
    async login(email, password) {
      let r; try { r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }); } catch (e) { throw new Error('Нет связи с базой'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error_code === 'invalid_credentials' ? 'Почта или пароль не подходят' : j.error_code === 'email_not_confirmed' ? 'Почта не подтверждена: в Supabase у пользователя нужен Auto Confirm' : r.status === 429 ? 'Слишком много попыток, подожди минуту' : 'Не получилось войти');
      keep(j); run();
    },
    async logout() { const a = auth(); localStorage.removeItem(AUTH); clearTimeout(timer); set('off'); if (a) { try { await call('/auth/v1/logout?scope=local', { method: 'POST' }, a.access); } catch (e) {} } },
    choose(how) { for (const n in docs) if (docs[n].first) docs[n].choice = how; run(); },
    start() {
      if (embedded) return;
      if (auth()) plan(50);
      const wake = () => { if (!document.hidden && auth() && state !== 'choose' && Date.now() - lastPull > 5000) run(); };
      document.addEventListener('visibilitychange', () => { if (document.hidden) { if (dirty.size && state !== 'choose') run(); } else wake(); });
      addEventListener('online', wake); setInterval(() => { if (!document.hidden && state !== 'choose' && auth() && Date.now() - lastPull > 45000) run(); }, 15000);
    },
  };
})();
