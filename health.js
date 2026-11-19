'use strict';
/* Импорт из Apple Здоровья через «Команды».
   Команда кладёт в буфер строки вида  КОД|начало|конец|значение
   КОДЫ: SLEEP STEPS KCAL WEIGHT WTEMP BTEMP WORK
   Подключается до app.js; функции app.js (iso, add, S, …) вызываются только во время работы. */

const H_CODES = ['SLEEP', 'STEPS', 'KCAL', 'WEIGHT', 'WTEMP', 'BTEMP', 'WORK'];
const H_NAMES = { SLEEP: 'сон', STEPS: 'шаги', KCAL: 'активность', WEIGHT: 'вес', WTEMP: 't° запястья', BTEMP: 'базальная t°', WORK: 'тренировки' };
const RU_MON = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function hNum(s) {
  s = String(s ?? '').replace(/(\d)[\s   ](?=\d)/g, '$1');
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}

function hWhen(s) {
  s = String(s ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3]);
  // ISO с временем: берём «настенное» время телефона как есть, смещение пояса игнорируем
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); }
  m = s.toLowerCase().match(/(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})(?:\D+?(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mi = RU_MON.findIndex(p => m[2].startsWith(p));
    if (mi >= 0) return new Date(+m[3], mi, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function hAsleep(val) {
  const v = String(val || '').toLowerCase().trim();
  if (/^\d+$/.test(v)) return ![0, 2].includes(+v);           // 0 — в кровати, 2 — бодрствование
  return !/кроват|in ?bed|бодрств|awake|проснул/.test(v);
}

function parseHealth(text) {
  const rows = [], bad = [];
  const blocks = {};          // формат без цикла: =КОД:start / =КОД:end / =КОД:value, дальше списки по строке
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^CYCLE-HEALTH/i.test(line)) continue;
    const mk = line.match(/^=\s*([A-Za-z]+)\s*:\s*(start|end|value)\s*$/i);
    if (mk) {
      const code = mk[1].toUpperCase();
      if (!H_CODES.includes(code)) { bad.push(line); cur = null; continue; }
      cur = ((blocks[code] ||= {})[mk[2].toLowerCase()] = []);
      continue;
    }
    if (cur && !line.includes('|')) { cur.push(line); continue; }
    cur = null;
    const p = line.split('|').map(x => x.trim());
    const code = (p[0] || '').toUpperCase();
    const st = hWhen(p[1]);
    if (!H_CODES.includes(code) || !st) { bad.push(line); continue; }
    rows.push({ code, st, en: hWhen(p[2]) || st, val: p.slice(3).join('|') });
  }
  for (const [code, b] of Object.entries(blocks)) {
    const st = b.start || [], en = b.end || [], val = b.value || [];
    if (val.length && val.length !== st.length) bad.push(`${code}: дат ${st.length}, значений ${val.length} — списки не совпадают`);
    for (let i = 0; i < st.length; i++) {
      const s0 = hWhen(st[i]);
      if (!s0) { bad.push(`${code}: ${st[i]}`); continue; }
      rows.push({ code, st: s0, en: hWhen(en[i]) || s0, val: val[i] ?? '' });
    }
  }
  return { rows, bad };
}

function aggregateHealth(rows) {
  const H = {}, cnt = {};
  const g = d => (H[d] ||= {});
  const latest = {};                       // для веса/температуры — последнее значение за день
  const sleeps = [];
  for (const r of rows) {
    const v = hNum(r.val);
    cnt[r.code] = (cnt[r.code] || 0) + 1;
    if (r.code === 'STEPS' || r.code === 'KCAL') {
      if (v == null) continue;
      const k = r.code === 'STEPS' ? 'steps' : 'kcal', d = iso(r.st);
      g(d)[k] = (g(d)[k] || 0) + v;
    } else if (r.code === 'WEIGHT' || r.code === 'BTEMP' || r.code === 'WTEMP') {
      if (v == null) continue;
      const k = { WEIGHT: 'weight', BTEMP: 'btemp', WTEMP: 'wtemp' }[r.code];
      const d = iso(r.code === 'WTEMP' ? r.en : r.st), key = k + d;
      if (!latest[key] || latest[key] < r.st) { latest[key] = r.st; g(d)[k] = v; }
    } else if (r.code === 'SLEEP') {
      if (hAsleep(r.val) && r.en > r.st) sleeps.push([+r.st, +r.en]);
    } else if (r.code === 'WORK') {
      const d = iso(r.st), min = Math.round((r.en - r.st) / 6e4);
      const name = r.val && hNum(r.val) === null ? r.val : 'Тренировка';
      (g(d).work ||= []).push({ n: name.slice(0, 40), min: min > 0 ? min : (hNum(r.val) || 0) });
    }
  }
  // сон: объединяем пересечения (часы + телефон) и относим к дате пробуждения
  sleeps.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of sleeps) {
    const l = merged[merged.length - 1];
    if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push([...s]);
  }
  for (const [a, b] of merged) { const d = iso(new Date(b)); g(d).sleep = (g(d).sleep || 0) + Math.round((b - a) / 6e4); }

  for (const d of Object.keys(H)) {
    const h = H[d];
    if (h.steps != null) h.steps = Math.round(h.steps);
    if (h.kcal != null) h.kcal = Math.round(h.kcal);
    if (h.weight != null) h.weight = Math.round(h.weight * 10) / 10;
    if (h.wtemp != null) h.wtemp = Math.round(h.wtemp * 100) / 100;
    if (h.btemp != null) h.btemp = Math.round(h.btemp * 100) / 100;
  }
  return { H, cnt, nights: merged.length };
}

function applyHealth(text) {
  const { rows, bad } = parseHealth(text);
  if (!rows.length) { showHealthResult({ rows, bad }); return false; }
  const { H, cnt } = aggregateHealth(rows);
  S.health ||= {};
  // поля из нового импорта заменяют старые за те же даты
  const touched = new Set(rows.map(r => r.code));
  const fields = { SLEEP: 'sleep', STEPS: 'steps', KCAL: 'kcal', WEIGHT: 'weight', WTEMP: 'wtemp', BTEMP: 'btemp', WORK: 'work' };
  const dates = Object.keys(H);
  for (const d of dates) {
    const cur = { ...(S.health[d] || {}) };
    for (const c of touched) delete cur[fields[c]];
    S.health[d] = { ...cur, ...H[d] };
  }
  S.healthAt = Date.now();
  save();
  showHealthResult({ rows, bad, cnt, dates });
  return true;
}

async function healthImport() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { /* нет доступа — покажем поле для вставки */ }
  if (new RegExp(`(${H_CODES.join('|')})(\\||\\s*:\\s*start)`, 'i').test(text)) return applyHealth(text);
  showSheet(`
    <div class="sh-hd"><div><h2>Вставь данные</h2><div class="sub">Сначала запусти команду «Цикл: Здоровье»</div></div>
      <button class="btn sm ghost" data-close>Закрыть</button></div>
    <div class="sec">
      <p class="muted small" style="margin:0 0 10px">Буфер обмена пуст или в нём не данные из команды. Запусти команду, вернись сюда и нажми «Вставить и загрузить» — или вставь текст вручную (долгое нажатие → «Вставить»).</p>
      <textarea id="h-paste" placeholder="SLEEP|…" style="min-height:120px"></textarea>
      <div class="cal-actions"><button class="btn ghost" data-act="h-clip">Вставить и загрузить</button><button class="btn" data-act="h-apply">Загрузить</button></div>
    </div>
    <button class="btn block ghost" data-act="h-help">Как настроить команду</button>`);
}

function showHealthResult({ rows, bad, cnt = {}, dates = [] }) {
  const list = H_CODES.filter(c => cnt[c]).map(c => `<span class="tag">${H_NAMES[c]}: ${cnt[c]}</span>`).join('');
  const range = dates.length ? `${fmt(dates.sort()[0])} — ${fmt(dates[dates.length - 1])}` : '';
  showSheet(`
    <div class="sh-hd"><div><h2>${rows.length ? 'Данные загружены' : 'Не получилось'}</h2><div class="sub">${range}</div></div>
      <button class="btn sm ghost" data-close>Готово</button></div>
    ${rows.length ? `<div class="sec"><h4>Получено записей</h4><div class="chips">${list}</div></div>` : ''}
    ${bad.length ? `<div class="sec"><h4>Не распознано строк: ${bad.length}</h4>
      <p class="muted small" style="margin:0 0 8px">Пример — пришли скриншот, если что-то не так:</p>
      <pre class="h-raw">${esc(bad.slice(0, 4).join('\n'))}</pre></div>` : ''}
    ${!rows.length ? `<button class="btn block ghost" data-act="h-help">Как настроить команду</button>` : ''}`);
}

/* ---------- отображение ---------- */
const fmtMin = m => `${Math.floor(m / 60)} ч ${pad(m % 60)} мин`;
const fmtNum = n => n.toLocaleString('ru-RU');
const fmtDec = (n, k = 1) => n.toFixed(k).replace('.', ',');

function wtempDev(d) {
  const H = S.health || {}, v = H[d]?.wtemp;
  if (v == null) return null;
  const base = [];
  for (let i = 1; i <= 30; i++) { const x = H[add(d, -i)]?.wtemp; if (x != null) base.push(x); }
  if (base.length < 5) return null;
  return v - base.reduce((a, b) => a + b, 0) / base.length;
}

function healthCard() {
  const H = S.health || {}, T = today();
  const has = Object.keys(H).length;
  if (!has) {
    return `<div class="card"><div class="logrow"><div><h2 style="margin:0 0 4px">Данные из Здоровья</h2>
      <div class="muted small">Сон, шаги, вес, температура и тренировки</div></div>
      <button class="btn sm ghost" data-act="h-help">Настроить</button></div></div>`;
  }
  const lastWith = k => { for (let i = 0; i < 4; i++) { const d = add(T, -i); if (H[d]?.[k] != null) return [d, H[d][k]]; } return null; };
  const sl = lastWith('sleep'), stp = H[T]?.steps, kc = H[T]?.kcal;
  let w = null; for (let i = 0; i < 30 && !w; i++) { const d = add(T, -i); if (H[d]?.weight != null) w = H[d].weight; }
  const wt = lastWith('wtemp'), dev = wt ? wtempDev(wt[0]) : null;
  const work = H[T]?.work || [];
  const items = [];
  if (sl) items.push(['😴', fmtMin(sl[1]), sl[0] === T ? 'сон этой ночью' : 'последний сон']);
  if (stp != null) items.push(['👟', fmtNum(stp), 'шагов сегодня']);
  if (kc != null) items.push(['🔥', `${fmtNum(kc)} ккал`, 'активность']);
  if (w != null) items.push(['⚖️', `${fmtDec(w)} кг`, 'вес']);
  if (wt) items.push(['🌡️', dev != null ? `${dev >= 0 ? '+' : '−'}${fmtDec(Math.abs(dev), 2)}°` : `${fmtDec(wt[1], 2)}°`, dev != null ? 't° запястья к норме' : 't° запястья']);
  if (work.length) items.push(['🏃', `${work.reduce((a, x) => a + x.min, 0)} мин`, work.map(x => x.n).join(', ').toLowerCase()]);
  const at = S.healthAt ? new Date(S.healthAt) : null;
  const atTxt = at ? (iso(at) === T ? `сегодня в ${at.toTimeString().slice(0, 5)}` : fmt(iso(at))) : '';
  return `<div class="card">
    <div class="logrow" style="margin-bottom:12px"><div><h2 style="margin:0 0 2px">Здоровье</h2><div class="muted small">обновлено ${atTxt}</div></div>
      <button class="btn sm ghost" data-act="h-import">Обновить</button></div>
    ${items.length ? `<div class="h-grid">${items.map(([i, v, l]) => `<div class="h-item"><span class="h-ico">${i}</span><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div>`
      : '<div class="muted small">За последние дни данных нет — запусти команду и нажми «Обновить».</div>'}
  </div>`;
}

function healthDaySection(d) {
  const h = (S.health || {})[d];
  if (!h) return '';
  const rows = [];
  if (h.sleep != null) rows.push(['Сон', fmtMin(h.sleep)]);
  if (h.steps != null) rows.push(['Шаги', fmtNum(h.steps)]);
  if (h.kcal != null) rows.push(['Активные калории', `${fmtNum(h.kcal)} ккал`]);
  if (h.weight != null) rows.push(['Вес', `${fmtDec(h.weight)} кг`]);
  if (h.wtemp != null) { const dv = wtempDev(d); rows.push(['t° запястья', `${fmtDec(h.wtemp, 2)}°${dv != null ? ` (${dv >= 0 ? '+' : '−'}${fmtDec(Math.abs(dv), 2)})` : ''}`]); }
  if (h.btemp != null) rows.push(['Базальная t°', `${fmtDec(h.btemp, 2)}°`]);
  for (const w of h.work || []) rows.push([w.n, `${w.min} мин`]);
  if (!rows.length) return '';
  return `<div class="sec"><h4><i style="background:#34A853"></i>Из Здоровья</h4>
    ${rows.map(([a, b]) => `<div class="h-row"><span>${esc(a)}</span><b>${b}</b></div>`).join('')}</div>`;
}

/* фаза для прошедшей даты */
function phaseOf(d, m) {
  const gi = m.groups.findLastIndex ? m.groups.findLastIndex(g => g.start <= d) : (() => { let k = -1; m.groups.forEach((g, i) => { if (g.start <= d) k = i; }); return k; })();
  if (gi < 0) return null;
  const g = m.groups[gi];
  if (d <= g.end) return 'period';
  const next = m.groups[gi + 1]?.start || add(g.start, m.L);
  if (diff(g.start, next) > 60 || d >= next) return null;
  const ov = add(next, -m.Lu);
  if (d >= add(ov, -5) && d <= add(ov, 1)) return 'fert';
  return d < ov ? 'foll' : 'lut';
}

function healthStats(m) {
  const H = S.health || {}, T = today();
  const dates = Object.keys(H).filter(d => d >= add(T, -180) && d <= T);
  if (dates.length < 3) return '';
  const ph = ['period', 'foll', 'fert', 'lut'];
  const phName = { period: 'Месяч.', foll: 'Фоллик.', fert: 'Фертил.', lut: 'Лютеин.' };
  const acc = {};
  for (const d of dates) {
    const p = phaseOf(d, m); if (!p) continue;
    const h = H[d], dev = wtempDev(d);
    const put = (k, v) => { if (v == null) return; ((acc[k] ||= {})[p] ||= []).push(v); };
    put('sleep', h.sleep); put('steps', h.steps); put('kcal', h.kcal); put('wtemp', dev);
  }
  const metrics = [
    ['sleep', 'Сон', v => `${fmtDec(v / 60)} ч`],
    ['steps', 'Шаги', v => fmtNum(Math.round(v / 100) * 100)],
    ['kcal', 'Активность', v => `${fmtNum(Math.round(v))}`],
    ['wtemp', 't° запястья', v => `${v >= 0 ? '+' : '−'}${fmtDec(Math.abs(v), 2)}`],
  ].filter(([k]) => acc[k]);
  let table = '';
  if (metrics.length) {
    table = `<div class="h-table"><div></div>${ph.map(p => `<div class="h-th">${phName[p]}</div>`).join('')}
      ${metrics.map(([k, n, f]) => `<div class="h-tl">${n}</div>${ph.map(p => {
        const a = acc[k][p]; return `<div class="h-td">${a && a.length ? f(a.reduce((x, y) => x + y, 0) / a.length) : '—'}</div>`;
      }).join('')}`).join('')}</div>`;
  }
  return `<div class="card"><h2>Здоровье по фазам<small>среднее за 6 мес.</small></h2>${table || '<div class="empty">Мало данных</div>'}
    ${tempChart(m)}</div>`;
}

function tempChart(m) {
  const H = S.health || {}, T = today(), N = 60;
  const key = Object.keys(H).some(d => H[d].wtemp != null) ? 'wtemp' : 'btemp';
  const pts = [];
  for (let i = N - 1; i >= 0; i--) { const d = add(T, -i), v = H[d]?.[key]; if (v != null) pts.push([N - 1 - i, v, d]); }
  if (pts.length < 5) return '';
  const vs = pts.map(p => p[1]), lo = Math.min(...vs) - .05, hi = Math.max(...vs) + .05;
  const W = 340, Ht = 110, X = i => 6 + i * (W - 12) / (N - 1), Y = v => 8 + (hi - v) / (hi - lo) * (Ht - 22);
  let bands = '';
  for (let i = 0; i < N; i++) {
    const d = add(T, -(N - 1 - i)), t = m.type[d];
    if (t === 'period') bands += `<rect x="${X(i) - 2.9}" y="0" width="5.8" height="${Ht - 12}" fill="var(--period)" opacity=".16"/>`;
    if (t === 'ovu') bands += `<rect x="${X(i) - 1}" y="0" width="2" height="${Ht - 12}" fill="var(--fert)" opacity=".7"/>`;
  }
  const line = pts.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  return `<h2 style="margin:18px 0 8px">${key === 'wtemp' ? 'Температура запястья' : 'Базальная температура'}<small>60 дней</small></h2>
    <svg viewBox="0 0 ${W} ${Ht}" class="h-chart">${bands}
      <polyline points="${line}" fill="none" stroke="var(--ink-2)" stroke-width="1.6" stroke-linejoin="round"/>
      ${pts.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.2" fill="var(--ink)"/>`).join('')}
      <text x="0" y="${Ht - 1}" font-size="10" fill="var(--ink-3)">${fmtShort(add(T, -(N - 1)))}</text>
      <text x="${W}" y="${Ht - 1}" font-size="10" fill="var(--ink-3)" text-anchor="end">сегодня</text></svg>
    <div class="legend" style="margin-top:6px"><span><i class="lg-p" style="opacity:.35"></i>Месячные</span><span><i style="width:3px;border-radius:0;background:var(--fert)"></i>Овуляция (расчёт)</span></div>`;
}

/* ---------- инструкция ---------- */
function healthHelp() {
  const code = s => `<code class="h-code">${s}</code>`;
  showSheet(`
    <div class="sh-hd"><div><h2>Команда «Здоровье»</h2><div class="sub">Настраивается один раз, ~10 минут</div></div>
      <button class="btn sm ghost" data-close>Закрыть</button></div>
    <div class="sec h-help">
      <h4>1. Создай команду</h4>
      <p>Открой «Команды» → «+». Назови её <b>Цикл: Здоровье</b>.</p>
    </div>
    <div class="sec h-help">
      <h4>2. Первый блок — шаги (2 действия)</h4>
      <ol>
        <li>Действие <b>«Найти образцы здоровья»</b>. Тип: <b>Шаги</b>. Фильтр: «Дата начала» — «за последние» — <b>14 дней</b>. «Группировать по» → <b>День</b>.</li>
        <li>Действие <b>«Текст»</b>. В нём шесть строк:
          <div class="h-tpl">${code('=STEPS:start')}<br><i>переменная</i> → «Дата начала»<br>${code('=STEPS:end')}<br><i>переменная</i> → «Дата окончания»<br>${code('=STEPS:value')}<br><i>переменная</i> → «Значение»</div>
          <i>Переменная</i> — результат «Найти образцы здоровья» (над клавиатурой «Образцы здоровья» или «Выбрать переменную»). Нажми на вставленную переменную и выбери нужное свойство; для дат поставь формат <b>ISO 8601</b> с временем.</li>
        <li><b>«Добавить в переменную»</b>, имя переменной <b>Данные</b> (на входе — этот «Текст»).</li>
      </ol>
    </div>
    <div class="sec h-help">
      <h4>3. Остальные блоки</h4>
      <p>Сделай такие же три действия для других типов, меняя <b>Тип</b> и <b>код</b> в трёх строках-метках (${code('=SLEEP:start')} и т.д.):</p>
      <div class="h-row"><span>Активная энергия <span class="muted">(группировка «День»)</span></span>${code('KCAL')}</div>
      <div class="h-row"><span>Анализ сна <span class="muted">(без группировки)</span></span>${code('SLEEP')}</div>
      <div class="h-row"><span>Вес</span>${code('WEIGHT')}</div>
      <div class="h-row"><span>Температура запястья во сне <span class="muted">(если есть в списке)</span></span>${code('WTEMP')}</div>
      <div class="h-row"><span>Базальная температура тела</span>${code('BTEMP')}</div>
      <div class="h-row"><span>Тренировки <span class="muted">(вместо «Значение» — «Тип»)</span></span>${code('WORK')}</div>
      <p class="muted">Если дублируешь блок — проверь, что переменные в новом «Тексте» ссылаются на новый «Найти образцы», а не на первый. Лишние блоки можно не делать.</p>
    </div>
    <div class="sec h-help">
      <h4>4. Финал</h4>
      <ol>
        <li>Действие <b>«Текст»</b>, внутри — только переменная <b>Данные</b>. Затем <b>«Скопировать в буфер обмена»</b> — на входе этот «Текст» (так в буфер попадут все блоки сразу).</li>
        <li><b>«Показать уведомление»</b>: «Готово, открой Цикл».</li>
        <li>Запусти команду — iOS спросит доступ к Здоровью, разреши все типы.</li>
        <li>Открой «Цикл» → карточка «Здоровье» → <b>«Обновить»</b> → «Вставить».</li>
      </ol>
      <p class="muted">Для первой загрузки истории можно временно поставить 90 дней вместо 14 — команда будет работать дольше.</p>
    </div>
    <div class="sec h-help">
      <h4>Удобно</h4>
      <p>Добавь команду на экран «Домой» или в «Автоматизацию» (например, каждый вечер в 22:00) — тогда останется только нажать «Обновить» в приложении.</p>
    </div>`);
}
