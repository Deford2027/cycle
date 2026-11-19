'use strict';
/* Цикл — личный трекер. Все данные лежат только в localStorage этого устройства. */

const KEY = 'cycle.v1';
const DEF_SETTINGS = { cycleLen: 28, periodLen: 5, luteal: 14, auto: true, pin: null };

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((parse(b) - parse(a)) / 864e5); // b − a, в днях
const today = () => iso(new Date());
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const days = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const bigDays = n => `${n}<small>${plural(n, 'день', 'дня', 'дней')}</small>`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (s, o = { day: 'numeric', month: 'long' }) => parse(s).toLocaleDateString('ru-RU', o);
const fmtShort = s => parse(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/* ---------- справочники ---------- */
const FLOW = [['light', 'Скудные'], ['medium', 'Умеренные'], ['heavy', 'Обильные'], ['spotting', 'Мажущие']];
const FLOW_NAME = Object.fromEntries(FLOW);
const SYMPTOMS = ['Всё хорошо', 'Спазмы', 'Головная боль', 'Боль в груди', 'Вздутие', 'Боль в спине', 'Акне',
  'Усталость', 'Тошнота', 'Бессонница', 'Тяга к сладкому', 'Головокружение', 'Диарея', 'Запор', 'Отёки'];
const MOODS = ['Спокойствие', 'Радость', 'Энергия', 'Игривость', 'Перепады', 'Раздражение', 'Грусть',
  'Тревога', 'Апатия', 'Чувствительность', 'Злость', 'Плаксивость'];
const DISCHARGE = ['Нет', 'Липкие', 'Кремообразные', 'Как яичный белок', 'Водянистые', 'Необычные'];
const SEX = ['Не было', 'С защитой', 'Без защиты'];

const QUICK = [
  ['period', 'Месячные', '🩸', 'var(--period)'], ['symptoms', 'Симптомы', '😣', '#8B6CD6'], ['mood', 'Настроение', '🙂', '#E39A2D'],
  ['discharge', 'Выделения', '💧', '#3B9BD9'], ['sex', 'Секс', '❤️', '#D3507F'], ['temp', 'Температура', '🌡️', '#7A8A99'], ['note', 'Заметка', '📝', '#7A8A99'],
];

const PHASES = {
  period: { name: 'Менструальная фаза', ico: '🩸', bg: 'var(--period-soft)',
    tip: 'Организм тратит больше сил. Тепло на низ живота, вода и спокойный темп помогают легче пройти эти дни.' },
  foll: { name: 'Фолликулярная фаза', ico: '🌱', bg: 'var(--card-2)',
    tip: 'Эстроген растёт — обычно больше энергии и хорошее настроение. Удачное время для активных тренировок и новых дел.' },
  fert: { name: 'Фертильное окно', ico: '✨', bg: 'var(--fert-soft)',
    tip: 'Вероятность беременности сейчас максимальная. Если беременность не в планах — позаботься о защите.' },
  lut: { name: 'Лютеиновая фаза', ico: '🌙', bg: 'var(--card-2)',
    tip: 'Ближе к месячным возможны ПМС, тяга к сладкому и усталость. Больше сна и чуть меньше нагрузки.' },
  late: { name: 'Задержка', ico: '⏳', bg: 'var(--card-2)',
    tip: 'Задержка бывает из-за стресса, болезни, перелётов или смены режима. Если она больше 5–7 дней — стоит сделать тест.' },
};

/* ---------- состояние ---------- */
let S = load();
let tab = 'today';
let calMonth = today().slice(0, 7);
let editing = false;
let editSnapshot = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.days) return { settings: { ...DEF_SETTINGS, ...s.settings }, days: s.days };
  } catch (e) { /* пусто или повреждено */ }
  return null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Не удалось сохранить'); }
}
const isPeriod = d => !!(d && d.period && d.period !== 'spotting');
const dayRec = d => S.days[d] || {};
function setDay(d, patch) {
  const rec = { ...dayRec(d), ...patch };
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete rec[k];
  }
  if (Object.keys(rec).length) S.days[d] = rec; else delete S.days[d];
  save();
}
const hasLog = d => { const r = S.days[d]; return !!r && Object.keys(r).some(k => k !== 'period'); };

/* ---------- модель цикла ---------- */
function model() {
  const st = S.settings, T = today();
  const pdays = Object.keys(S.days).filter(d => isPeriod(S.days[d])).sort();

  // соседние дни месячных (с пропуском до 1 дня) — один эпизод
  const groups = [];
  for (const d of pdays) {
    const g = groups[groups.length - 1];
    if (g && diff(g.end, d) <= 2) g.end = d; else groups.push({ start: d, end: d });
  }
  const cycles = groups.map((g, i) => {
    const n = groups[i + 1];
    return { start: g.start, periodEnd: g.end, periodLen: diff(g.start, g.end) + 1, len: n ? diff(g.start, n.start) : null };
  });

  const validLens = cycles.filter(c => c.len && c.len >= 15 && c.len <= 60).slice(-6).map(c => c.len);
  const validP = cycles.filter(c => c.periodLen >= 2 && c.periodLen <= 12).slice(-6).map(c => c.periodLen);
  let L = st.cycleLen, P = st.periodLen;
  if (st.auto) {
    if (validLens.length) L = Math.round(avg(validLens));
    if (validP.length) P = Math.round(avg(validP));
  }
  const Lu = Math.min(st.luteal, L - P - 2);

  const last = groups.filter(g => g.start <= T).pop() || groups[groups.length - 1] || null;
  const lastAny = groups[groups.length - 1] || null;

  // прогноз месячных
  const preds = [];
  if (lastAny) {
    for (let k = 1; preds.length < 12 && k < 60; k++) {
      const s = add(lastAny.start, k * L), e = add(s, P - 1);
      if (e < T) continue;
      preds.push({ start: s, end: e });
    }
  }

  // типы дней для календаря
  const type = {};
  const starts = groups.map(g => g.start);
  if (lastAny) for (let k = 1; k <= 13; k++) starts.push(add(lastAny.start, k * L));
  const ovus = [];
  for (let i = 0; i + 1 < starts.length; i++) {
    const gap = diff(starts[i], starts[i + 1]);
    if (gap < 15 || gap > 60) continue;
    const ov = add(starts[i + 1], -Lu);
    ovus.push(ov);
    for (let j = -5; j <= 1; j++) type[add(ov, j)] = 'fert';
  }
  for (const ov of ovus) type[ov] = 'ovu';
  for (const p of preds) for (let d = p.start; d <= p.end; d = add(d, 1)) type[d] = 'pred';
  for (const d of pdays) type[d] = 'period';

  return { T, groups, cycles, L, P, Lu, last, preds, type, ovus };
}

function status(m) {
  const { T, L, Lu, last, type } = m;
  if (!last) return null;
  const day = diff(last.start, T) + 1;
  const next = add(last.start, L);
  const ov = add(next, -Lu);
  const inPeriod = T >= last.start && T <= last.end && isPeriod(S.days[T]);
  const r = { day, next, ov, inPeriod, cls: '' };

  const dOv = diff(T, ov);
  r.chance = type[T] === 'fert' || type[T] === 'ovu' ? (dOv >= 0 && dOv <= 2 ? 'high' : 'mid') : 'low';

  if (inPeriod) {
    r.t1 = 'Месячные'; r.t2 = `${diff(last.start, T) + 1}<small>-й день</small>`; r.cls = 'period';
    r.t3 = `${day}-й день цикла`; r.phase = 'period'; r.chance = 'low';
  } else if (T >= next) {
    const late = diff(next, T);
    if (late === 0) { r.t1 = 'Месячные ожидаются'; r.t2 = 'Сегодня'; r.t3 = `${day}-й день цикла`; r.cls = 'period'; r.phase = 'lut'; }
    else { r.t1 = 'Задержка'; r.t2 = bigDays(late); r.t3 = `${day}-й день цикла`; r.phase = 'late'; }
    r.chance = 'low';
  } else {
    const n = diff(T, next);
    r.t1 = 'До месячных'; r.t2 = n === 1 ? 'Завтра' : bigDays(n);
    if (T === ov) { r.t3 = 'Сегодня день овуляции'; r.cls = 'fert'; }
    else if (dOv > 0 && dOv <= 14) r.t3 = `Овуляция через ${days(dOv)}`;
    else r.t3 = `${day}-й день цикла`;
    r.phase = type[T] === 'fert' || type[T] === 'ovu' ? 'fert' : T < ov ? 'foll' : 'lut';
    if (r.phase === 'fert' && !r.cls) r.cls = 'fert';
  }
  return r;
}

/* ---------- рендер ---------- */
const view = $('#view');
function render() {
  document.body.classList.toggle('noapp', !S);
  if (!S) return renderOnboarding();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ today: renderToday, cal: renderCal, stats: renderStats, set: renderSettings })[tab]();
}

function dayCell(d, m, extra = '') {
  const t = m.type[d] || '';
  const cls = ['day', t, d === m.T ? 'today' : '', hasLog(d) ? 'has' : ''].join(' ');
  return `<span class="${cls}">${parse(d).getDate()}</span>${extra}`;
}

/* ---- Сегодня ---- */
function ringSvg(m, st) {
  const N = Math.max(m.L, st.day);
  const c = 150, r = 124;
  const dotR = Math.min(10.5, (2 * Math.PI * r / N) * .37);
  const pt = i => { const rad = (i * 360 / N - 90) * Math.PI / 180; return [c + r * Math.cos(rad), c + r * Math.sin(rad)]; };
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim();
  const colors = { period: col('--period'), pred: col('--period'), fert: col('--fert'), ovu: col('--ovu') };
  let dots = '';
  for (let i = 0; i < N; i++) {
    if (i === st.day - 1) continue; // сегодняшний рисуем отдельно, поверх
    const d = add(m.last.start, i), t = m.type[d];
    const [x, y] = pt(i);
    const color = colors[t] || (d <= m.T ? col('--track-2') : col('--track'));
    const op = t === 'pred' ? .4 : t === 'fert' && d > m.T ? .75 : 1;
    const rr = t === 'ovu' ? dotR + 1.5 : dotR;
    dots += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${rr.toFixed(2)}" fill="${color}" fill-opacity="${op}"/>`;
  }
  const [tx, ty] = pt(st.day - 1);
  const tc = colors[m.type[m.T]] || col('--ink');
  return `<svg viewBox="0 0 300 300" aria-hidden="true">${dots}
    <circle class="ring-halo" cx="${tx}" cy="${ty}" r="${dotR + 10}" fill="${tc}" fill-opacity=".18"/>
    <circle cx="${tx}" cy="${ty}" r="${dotR + 6}" fill="${tc}" stroke="${col('--card')}" stroke-width="3"/>
    <text x="${tx}" y="${ty}" dy=".35em" text-anchor="middle" font-size="13" font-weight="700" fill="${col('--card')}" font-family="-apple-system, system-ui, sans-serif">${st.day}</text></svg>`;
}

function renderToday() {
  const m = model(), st = status(m), T = m.T;
  const dateStr = cap(parse(T).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }));

  if (!st) {
    view.innerHTML = `<div class="fade"><div class="hd"><div><h1>Сегодня</h1><div class="date">${dateStr}</div></div></div>
      <div class="card empty">Пока нет отмеченных месячных.<br><br><button class="btn" data-act="start">Месячные начались сегодня</button></div></div>`;
    return;
  }

  const chanceTxt = { low: 'Низкая вероятность беременности', mid: 'Средняя вероятность беременности', high: 'Высокая вероятность беременности' }[st.chance];
  const week = [];
  for (let i = -3; i <= 3; i++) {
    const d = add(T, i);
    week.push(`<button data-day="${d}" class="${d === T ? 'today' : ''}"><span class="wd">${d === T ? 'Сег' : WD[(parse(d).getDay() + 6) % 7]}</span>${dayCell(d, m)}</button>`);
  }

  const rec = dayRec(T);
  const tags = [];
  if (rec.period) tags.push(`<span class="tag p">${FLOW_NAME[rec.period]}</span>`);
  for (const k of ['symptoms', 'mood']) (rec[k] || []).forEach(x => tags.push(`<span class="tag">${esc(x)}</span>`));
  if (rec.discharge) tags.push(`<span class="tag">Выделения: ${esc(rec.discharge.toLowerCase())}</span>`);
  if (rec.sex) tags.push(`<span class="tag">Секс: ${esc(rec.sex.toLowerCase())}</span>`);
  if (rec.temp) tags.push(`<span class="tag">${esc(rec.temp)} °C</span>`);
  if (rec.weight) tags.push(`<span class="tag">${esc(rec.weight)} кг</span>`);
  if (rec.note) tags.push(`<span class="tag">📝 Заметка</span>`);

  const ph = PHASES[st.phase];
  const btn = st.inPeriod
    ? `<button class="btn sm ghost" data-act="end">Закончились</button>`
    : `<button class="btn sm" data-act="start">Месячные начались</button>`;

  view.innerHTML = `<div class="fade">
    <div class="hd"><div><h1>Сегодня</h1><div class="date">${dateStr}</div></div>
      <button class="icon-btn" data-tab-go="cal" aria-label="Календарь"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></button></div>
    <div class="week">${week.join('')}</div>
    <div class="ring-wrap">${ringSvg(m, st)}
      <div class="ring-c ${st.cls}">
        <div class="t1">${st.t1}</div><div class="t2">${st.t2}</div><div class="t3">${st.t3}</div>
        ${btn}
      </div>
    </div>
    <div style="text-align:center;margin-bottom:18px"><span class="chance ${st.chance}"><i></i>${chanceTxt}</span></div>
    <div class="quick">${QUICK.map(([k, n, ico, c]) => {
      const done = k === 'temp' ? rec.temp || rec.weight : Array.isArray(rec[k]) ? rec[k].length : rec[k];
      return `<button data-quick="${k}" class="${done ? 'done' : ''}" style="--qc:${c}"><span class="q-ico">${ico}</span><span class="q-lbl">${n}</span></button>`;
    }).join('')}</div>
    <div class="card">
      <div class="logrow"><div><h2 style="margin:0 0 4px">Как ты сегодня?</h2>
        <div class="muted small">${tags.length ? 'Записано за сегодня' : 'Симптомы, настроение, выделения'}</div></div>
        <button class="addbtn" data-day="${T}" aria-label="Добавить"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>
      ${tags.length ? `<div class="chips" style="margin-top:14px">${tags.join('')}</div>` : ''}
    </div>
    <div class="card"><div class="phase"><div class="ph-dot" style="background:${ph.bg}">${ph.ico}</div>
      <div><h3>${ph.name}</h3><p>${ph.tip}</p></div></div></div>
    <div class="card">
      <h2>Ближайшие события</h2>
      ${upcoming(m, st)}
    </div>
  </div>`;
}

function upcoming(m, st) {
  const T = m.T, items = [];
  const nextOv = m.ovus.find(o => o > T);
  const np = m.preds.find(p => p.start > T);
  if (nextOv) items.push(['Овуляция', nextOv, 'var(--fert)']);
  if (np) items.push(['Месячные', np.start, 'var(--period)']);
  items.sort((a, b) => a[1] < b[1] ? -1 : 1);
  if (!items.length) return '<div class="muted small">Нет данных</div>';
  return items.map(([n, d, c]) => `<div class="row" style="padding:10px 0;min-height:0">
    <div class="rt"><div style="display:flex;align-items:center;gap:10px"><i style="width:10px;height:10px;border-radius:50%;background:${c}"></i>${n}</div></div>
    <div class="muted small">${fmt(d)} · через ${days(diff(T, d))}</div></div>`).join('');
}

/* ---- Календарь ---- */
function renderCal() {
  const m = model(), T = m.T;
  const first = parse(calMonth + '-01');
  const monthName = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  const offset = (first.getDay() + 6) % 7;
  const nDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const limit = add(T, 30);
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<button class="out" tabindex="-1"></button>';
  for (let i = 1; i <= nDays; i++) {
    const d = `${calMonth}-${pad(i)}`;
    const on = isPeriod(S.days[d]);
    const cls = [d > T ? 'future' : '', on ? 'on' : '', editing && d > limit ? 'locked' : ''].join(' ');
    cells += `<button data-cday="${d}" class="${cls}">${dayCell(d, m, '<span class="chk"></span>')}</button>`;
  }

  view.innerHTML = `<div class="fade ${editing ? 'editing' : ''}">
    <div class="hd"><h1>${editing ? 'Отметь дни' : 'Календарь'}</h1>
      ${editing ? '' : `<button class="link" data-act="go-today">Сегодня</button>`}</div>
    <div class="card" id="cal-card">
      <div class="hd" style="margin:0 0 10px">
        <button class="icon-btn" data-act="prev" aria-label="Назад"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="cal-month">${monthName}</div>
        <button class="icon-btn" data-act="next" aria-label="Вперёд"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="cal-head">${WD.map(w => `<div>${w}</div>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      ${editing ? '<div class="sel-info">Нажимай на дни, чтобы отметить или снять месячные.</div>' : ''}
    </div>
    ${editing
      ? `<div class="cal-actions"><button class="btn ghost" data-act="edit-cancel">Отмена</button><button class="btn" data-act="edit-done">Готово</button></div>`
      : `<div class="card"><div class="legend">
          <span><i class="lg-p"></i>Месячные</span><span><i class="lg-pr"></i>Прогноз</span>
          <span><i class="lg-f"></i>Фертильные дни</span><span><i class="lg-o"></i>Овуляция</span></div></div>
        <button class="btn block" data-act="edit">Изменить даты месячных</button>`}
  </div>`;
}

function shiftMonth(n) {
  const d = parse(calMonth + '-01'); d.setMonth(d.getMonth() + n);
  calMonth = iso(d).slice(0, 7); render();
}

/* ---- Статистика ---- */
function renderStats() {
  const m = model(), T = m.T;
  const done = m.cycles.filter(c => c.len);
  const lens = done.filter(c => c.len >= 15 && c.len <= 60).map(c => c.len);
  const reg = lens.length >= 3 ? (Math.max(...lens) - Math.min(...lens) <= 7 ? 'Регулярный' : 'Нерегулярный') : '—';
  const regSub = lens.length >= 3 ? `разброс ${Math.max(...lens) - Math.min(...lens)} дн.` : 'нужно 3+ цикла';

  const hist = m.cycles.slice(-12).reverse();
  const maxLen = Math.max(m.L, ...hist.map(c => c.len || diff(c.start, T) + 1), 1);
  const rows = hist.map(c => {
    const len = c.len || diff(c.start, T) + 1;
    const cur = !c.len;
    const lu = Math.min(m.Lu, len - c.periodLen - 2);
    const ovPos = c.len ? c.len - lu : null;
    return `<div class="hist-row">
      <div class="lbl">${fmtShort(c.start)}${cur ? '<br><span style="color:var(--period)">сейчас</span>' : ''}</div>
      <div class="bar ${cur ? 'cur' : ''}" style="width:${(len / maxLen * 100).toFixed(1)}%">
        <div class="p" style="width:${(c.periodLen / len * 100).toFixed(1)}%"></div>
        ${ovPos ? `<div class="f" style="left:${((ovPos - 6) / len * 100).toFixed(1)}%;width:${(7 / len * 100).toFixed(1)}%"></div>` : ''}
      </div>
      <div class="num">${len}</div></div>`;
  }).join('');

  const since = add(T, -180), cnt = {};
  for (const [d, r] of Object.entries(S.days)) {
    if (d < since) continue;
    for (const s of (r.symptoms || []).concat(r.mood || [])) if (s !== 'Всё хорошо') cnt[s] = (cnt[s] || 0) + 1;
  }
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topMax = top.length ? top[0][1] : 1;

  view.innerHTML = `<div class="fade">
    <div class="hd"><h1>Статистика</h1></div>
    <div class="tiles">
      <div class="tile"><b>${m.L}<small>дн.</small></b><span>Средний цикл</span></div>
      <div class="tile"><b>${m.P}<small>дн.</small></b><span>Средние месячные</span></div>
      <div class="tile"><b style="font-size:21px;padding:4px 0 3px">${reg}</b><span>${regSub}</span></div>
      <div class="tile"><b>${done.length}</b><span>${plural(done.length, 'цикл записан', 'цикла записано', 'циклов записано')}</span></div>
    </div>
    <div class="card"><h2>История циклов<small>длина, дн.</small></h2>
      ${rows || '<div class="empty">Отметь месячные, и здесь появится история</div>'}
      ${rows ? `<div class="legend" style="margin-top:12px"><span><i class="lg-p"></i>Месячные</span><span><i class="lg-f" style="background:var(--fert);opacity:.55"></i>Фертильное окно</span></div>` : ''}
    </div>
    <div class="card"><h2>Частые симптомы<small>за 6 месяцев</small></h2>
      ${top.length ? top.map(([n, v]) => `<div class="freq"><div>${esc(n)}</div><div class="bar"><div class="p" style="width:${(v / topMax * 100).toFixed(0)}%"></div></div><div class="num">${v}</div></div>`).join('')
        : '<div class="empty">Записывай симптомы и настроение — тут появятся закономерности</div>'}
    </div>
  </div>`;
}

/* ---- Настройки ---- */
function stepper(key, val, min, max, dis) {
  return `<div class="stepper ${dis ? 'dis' : ''}"><button data-step="${key}" data-d="-1" data-min="${min}" data-max="${max}">−</button><span>${val}</span><button data-step="${key}" data-d="1" data-min="${min}" data-max="${max}">+</button></div>`;
}
function renderSettings() {
  const st = S.settings, m = model();
  view.innerHTML = `<div class="fade">
    <div class="hd"><h1>Настройки</h1></div>
    <div class="group-t">Цикл</div>
    <div class="group">
      <div class="row"><div class="rt"><div>Считать автоматически</div><div>По отмеченным циклам${st.auto ? ` · сейчас ${m.L} / ${m.P} дн.` : ''}</div></div>
        <label class="switch"><input type="checkbox" data-set="auto" ${st.auto ? 'checked' : ''}><i></i></label></div>
      <div class="row"><div class="rt"><div>Длина цикла</div></div>${stepper('cycleLen', st.cycleLen, 18, 50, st.auto)}</div>
      <div class="row"><div class="rt"><div>Длина месячных</div></div>${stepper('periodLen', st.periodLen, 1, 12, st.auto)}</div>
      <div class="row"><div class="rt"><div>Лютеиновая фаза</div><div>Дней от овуляции до месячных</div></div>${stepper('luteal', st.luteal, 9, 18)}</div>
    </div>
    <div class="note">Если включён авто-режим, длины считаются как среднее по последним 6 циклам. Ручные значения используются, пока данных нет.</div>

    <div class="group-t">Напоминания</div>
    <div class="group">
      <button class="row" data-act="ics"><div class="rt"><div>Добавить прогноз в Календарь iPhone</div><div>6 ближайших месячных и овуляций, напоминание за 2 дня</div></div><span class="chev">›</span></button>
    </div>
    <div class="note">Обнови после пары новых циклов — прогноз уточняется.</div>

    <div class="group-t">Данные</div>
    <div class="group">
      <button class="row" data-act="export"><div class="rt"><div>Сохранить резервную копию</div><div>Файл .json — в «Файлы», Telegram или почту</div></div><span class="chev">›</span></button>
      <button class="row" data-act="import"><div class="rt"><div>Восстановить из копии</div></div><span class="chev">›</span></button>
      <button class="row" data-act="pin"><div class="rt"><div>${st.pin ? 'Убрать код-пароль' : 'Код-пароль на вход'}</div><div>${st.pin ? 'Включён' : 'Выключен'}</div></div><span class="chev">›</span></button>
      <button class="row danger" data-act="wipe"><div class="rt"><div>Удалить все данные</div></div></button>
    </div>
    <div class="note">Все записи хранятся только на этом iPhone — без сервера, аккаунтов и рекламы. Время от времени сохраняй резервную копию: при удалении приложения с экрана «Домой» данные удаляются вместе с ним.<br><br>Прогноз приблизительный и не подходит как метод контрацепции.</div>
  </div>`;
}

/* ---- Онбординг ---- */
let ob = { start: today(), plen: 5, clen: 28 };
function renderOnboarding() {
  view.innerHTML = `<div class="ob fade">
    <img class="ob-logo" src="icons/icon-192.png" alt="">
    <h1>Привет!</h1>
    <p>Пара вопросов — и я посчитаю прогноз.<br>Всё хранится только на этом телефоне.</p>
    <div class="card">
      <div class="row"><div class="rt">Начало последних месячных</div>
        <input type="date" id="ob-start" value="${ob.start}" max="${today()}"></div>
      <div class="row"><div class="rt">Сколько обычно длятся</div>${stepper('ob-plen', ob.plen, 1, 12)}</div>
      <div class="row"><div class="rt"><div>Длина цикла</div><div>Не знаешь — оставь 28</div></div>${stepper('ob-clen', ob.clen, 18, 50)}</div>
    </div>
    <button class="btn block" data-act="ob-go">Начать</button>
    <div class="alt"><button class="link" data-act="import">Восстановить из резервной копии</button></div>
  </div>`;
}

/* ---------- лист дня ---------- */
let sheetDay = null;
function openDay(d) {
  const T = today();
  if (d > T) {
    const m = model();
    const t = { pred: 'Прогноз: месячные', fert: 'Прогноз: фертильные дни', ovu: 'Прогноз: овуляция' }[m.type[d]] || 'Нет событий';
    return toast(`${fmt(d)} — ${t}`);
  }
  sheetDay = d;
  renderSheet();
  const sh = $('#sheet');
  sh.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add('open')));
}
function closeSheet() {
  const sh = $('#sheet');
  if (sh.hidden) return;
  saveNumbers();
  sh.classList.remove('open');
  setTimeout(() => { sh.hidden = true; sheetDay = null; render(); }, 280);
}
function optGroup(field, list, multi, cls, cur) {
  return `<div class="opt ${cls}">${list.map(([v, n]) => {
    const on = multi ? (cur || []).includes(v) : cur === v;
    return `<button class="${on ? 'on' : ''}" data-f="${field}" data-v="${esc(v)}" data-multi="${multi ? 1 : ''}">${esc(n)}</button>`;
  }).join('')}</div>`;
}
const pairs = a => a.map(x => [x, x]);
function renderSheet() {
  const d = sheetDay, r = dayRec(d), T = today();
  const title = d === T ? 'Сегодня' : d === add(T, -1) ? 'Вчера' : fmt(d);
  const cd = (() => { const m = model(); const g = m.groups.filter(g => g.start <= d).pop(); return g ? diff(g.start, d) + 1 : null; })();
  $('#sheet-body').innerHTML = `
    <div class="sh-hd"><div><h2>${title}</h2><div class="sub">${cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${cd ? ` · ${cd}-й день цикла` : ''}</div></div>
      <button class="btn sm ghost" data-close>Готово</button></div>
    <div class="sec" id="sec-period"><h4><i style="background:var(--period)"></i>Месячные</h4>${optGroup('period', FLOW, false, 'c-flow', r.period)}</div>
    <div class="sec" id="sec-symptoms"><h4><i style="background:#8B6CD6"></i>Самочувствие</h4>${optGroup('symptoms', pairs(SYMPTOMS), true, 'c-sym', r.symptoms)}</div>
    <div class="sec" id="sec-mood"><h4><i style="background:#E39A2D"></i>Настроение</h4>${optGroup('mood', pairs(MOODS), true, 'c-mood', r.mood)}</div>
    <div class="sec" id="sec-discharge"><h4><i style="background:#3B9BD9"></i>Выделения</h4>${optGroup('discharge', pairs(DISCHARGE), false, 'c-dis', r.discharge)}</div>
    <div class="sec" id="sec-sex"><h4><i style="background:#D3507F"></i>Секс</h4>${optGroup('sex', pairs(SEX), false, 'c-sex', r.sex)}</div>
    <div class="sec" id="sec-temp"><h4><i style="background:var(--ink-3)"></i>Измерения</h4>
      <div class="nums">
        <label class="field">Базальная t°, °C<input id="n-temp" inputmode="decimal" placeholder="36,6" value="${esc(r.temp || '')}"></label>
        <label class="field">Вес, кг<input id="n-weight" inputmode="decimal" placeholder="—" value="${esc(r.weight || '')}"></label>
      </div></div>
    <div class="sec" id="sec-note"><h4><i style="background:var(--ink-3)"></i>Заметка</h4>
      <textarea id="n-note" placeholder="Лекарства, тест, что угодно…">${esc(r.note || '')}</textarea></div>`;
}
function saveNumbers() {
  if (!sheetDay) return;
  const v = id => ($('#' + id)?.value || '').trim();
  const num = s => s.replace('.', ',');
  setDay(sheetDay, { temp: num(v('n-temp')), weight: num(v('n-weight')), note: v('n-note') });
}

/* ---------- действия ---------- */
function markStart() {
  const m = model(), T = today();
  for (let i = 0; i < m.P; i++) {
    const d = add(T, i);
    if (!isPeriod(S.days[d])) setDay(d, { period: 'medium' });
  }
  toast(`Отмечено ${days(m.P)} — поправь в календаре, если нужно`);
  render();
}
function markEnd() {
  const m = model(), T = today();
  const g = m.groups.find(g => g.start <= T && g.end >= T);
  if (g) for (let d = add(T, 1); d <= g.end; d = add(d, 1)) setDay(d, { period: undefined });
  toast('Месячные закончились сегодня');
  render();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}
function exportData() {
  const data = { app: 'cycle', version: 1, exported: new Date().toISOString(), settings: { ...S.settings, pin: null }, days: S.days };
  shareOrDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), `cycle-backup-${today()}.json`);
}
function importData(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = JSON.parse(fr.result);
      if (!data || typeof data.days !== 'object') throw new Error();
      const n = Object.keys(data.days).length;
      if (S && Object.keys(S.days).length && !confirm(`Заменить текущие данные копией (${n} дн. записей)?`)) return;
      S = { settings: { ...DEF_SETTINGS, ...data.settings, pin: S?.settings.pin || null }, days: data.days };
      save(); tab = 'today'; render(); toast('Данные восстановлены');
    } catch (e) { toast('Это не похоже на файл резервной копии'); }
  };
  fr.readAsText(file);
}
function exportIcs() {
  const m = model();
  if (!m.preds.length) return toast('Сначала отметь месячные');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ymd = s => s.replace(/-/g, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cycle-app//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const ev = (uid, d, title, alarmText) => {
    L.push('BEGIN:VEVENT', `UID:${uid}@cycle-app`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(d)}`,
      `DTEND;VALUE=DATE:${ymd(add(d, 1))}`, `SUMMARY:${title}`, 'TRANSP:TRANSPARENT');
    if (alarmText) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${alarmText}`, 'TRIGGER:-P1DT15H', 'END:VALARM');
    L.push('END:VEVENT');
  };
  m.preds.slice(0, 6).forEach(p => ev(`p-${p.start}`, p.start, '🩸 Месячные (прогноз)', 'Через 2 дня ожидаются месячные'));
  m.ovus.filter(o => o > m.T).slice(0, 6).forEach(o => ev(`o-${o}`, o, '✨ Овуляция (прогноз)', ''));
  L.push('END:VCALENDAR');
  download(new Blob([L.join('\r\n')], { type: 'text/calendar' }), 'cycle-prognoz.ics');
}

/* ---------- PIN ---------- */
async function hash(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cycle-salt:' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function pinPad(title, onDone, cancelable) {
  const lock = $('#lock');
  let code = '';
  const draw = (err) => {
    lock.innerHTML = `<img class="ob-logo" src="icons/icon-192.png" alt="" style="margin:0">
      <h2>${title}</h2>
      <div class="dots ${err ? 'err' : ''}">${[0, 1, 2, 3].map(i => `<i class="${i < code.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button class="fn" data-k="x">${cancelable ? 'Отмена' : ''}</button><button data-k="0">0</button><button class="fn" data-k="del">Стереть</button></div>`;
  };
  lock.onclick = async e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    if (k === 'x') { if (cancelable) { lock.hidden = true; } return; }
    if (k === 'del') code = code.slice(0, -1); else if (code.length < 4) code += k;
    draw();
    if (code.length === 4) {
      const ok = await onDone(code);
      if (ok) lock.hidden = true; else { code = ''; draw(true); }
    }
  };
  draw();
  lock.hidden = false;
}
function setupPin() {
  if (S.settings.pin) {
    if (!confirm('Убрать код-пароль?')) return;
    S.settings.pin = null; save(); render(); return toast('Код-пароль выключен');
  }
  let first = null;
  pinPad('Придумай код из 4 цифр', async code => {
    if (!first) { first = code; setTimeout(() => pinPad('Повтори код', async c2 => {
      if (c2 !== first) { toast('Коды не совпали'); first = null; setTimeout(setupPin, 50); return true; }
      S.settings.pin = await hash(c2); save(); render(); toast('Код-пароль включён'); return true;
    }, true), 0); return true; }
  }, true);
}
function checkLock() {
  if (S?.settings.pin) pinPad('Введи код', async code => (await hash(code)) === S.settings.pin, false);
}

/* ---------- события ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

document.addEventListener('click', e => {
  const el = e.target.closest('button, [data-close]');
  if (!el) return;
  const ds = el.dataset;

  if (ds.close !== undefined) return closeSheet();
  if (ds.tab) { if (editing) return; tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.tabGo) { tab = ds.tabGo; calMonth = today().slice(0, 7); render(); return; }
  if (ds.day) return openDay(ds.day);
  if (ds.quick) {
    openDay(today());
    const body = $('#sheet-body'), sec = $('#sec-' + ds.quick);
    if (sec) {
      body.scrollTop = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 72;
      sec.classList.add('flash');
    }
    return;
  }

  if (ds.cday) {
    const d = ds.cday;
    if (editing) {
      if (d > add(today(), 30)) return;
      setDay(d, { period: isPeriod(S.days[d]) ? undefined : 'medium' });
      return render();
    }
    return openDay(d);
  }

  if (ds.f) {
    const f = ds.f, v = ds.v, r = dayRec(sheetDay);
    if (ds.multi) {
      let a = [...(r[f] || [])];
      a = a.includes(v) ? a.filter(x => x !== v) : [...a, v];
      if (f === 'symptoms' && v === 'Всё хорошо' && a.includes(v)) a = [v];
      else if (f === 'symptoms') a = a.filter(x => x !== 'Всё хорошо' || v === 'Всё хорошо');
      setDay(sheetDay, { [f]: a });
    } else {
      setDay(sheetDay, { [f]: r[f] === v ? undefined : v });
    }
    saveNumbers();
    const sc = $('#sheet-body').scrollTop; renderSheet(); $('#sheet-body').scrollTop = sc;
    return;
  }

  if (ds.step) {
    const k = ds.step, dlt = +ds.d, min = +ds.min, max = +ds.max;
    if (k.startsWith('ob-')) {
      const key = k === 'ob-plen' ? 'plen' : 'clen';
      ob.start = $('#ob-start')?.value || ob.start;
      ob[key] = Math.min(max, Math.max(min, ob[key] + dlt)); return render();
    }
    S.settings[k] = Math.min(max, Math.max(min, S.settings[k] + dlt)); save(); return render();
  }

  switch (ds.act) {
    case 'start': return markStart();
    case 'end': return markEnd();
    case 'prev': return shiftMonth(-1);
    case 'next': return shiftMonth(1);
    case 'go-today': calMonth = today().slice(0, 7); return render();
    case 'edit': editing = true; editSnapshot = JSON.stringify(S.days); return render();
    case 'edit-done': editing = false; editSnapshot = null; return render();
    case 'edit-cancel': editing = false; S.days = JSON.parse(editSnapshot); editSnapshot = null; save(); return render();
    case 'export': return exportData();
    case 'import': return $('#file').click();
    case 'ics': return exportIcs();
    case 'pin': return setupPin();
    case 'wipe':
      if (confirm('Удалить все записи безвозвратно?') && confirm('Точно? Восстановить можно только из резервной копии.')) {
        localStorage.removeItem(KEY); S = null; tab = 'today'; render();
      }
      return;
    case 'ob-go': {
      const start = $('#ob-start').value || today();
      if (start > today()) return toast('Дата не может быть в будущем');
      S = { settings: { ...DEF_SETTINGS, cycleLen: ob.clen, periodLen: ob.plen }, days: {} };
      for (let i = 0; i < ob.plen; i++) S.days[add(start, i)] = { period: 'medium' };
      save(); tab = 'today'; render(); return;
    }
  }
});

document.addEventListener('change', e => {
  if (e.target.dataset.set === 'auto') { S.settings.auto = e.target.checked; save(); render(); }
  if (e.target.id === 'ob-start') ob.start = e.target.value;
  if (e.target.id === 'file' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('focusout', e => { if (e.target.closest('#sheet-body') && e.target.matches('input, textarea')) saveNumbers(); });

// свайп по календарю — смена месяца
let tx0 = null, ty0 = null;
view.addEventListener('touchstart', e => {
  if (tab !== 'cal' || !e.target.closest('#cal-card')) return;
  tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY;
}, { passive: true });
view.addEventListener('touchend', e => {
  if (tx0 === null) return;
  const dx = e.changedTouches[0].clientX - tx0, dy = e.changedTouches[0].clientY - ty0;
  tx0 = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftMonth(dx < 0 ? 1 : -1);
}, { passive: true });

// свайп листа вниз — закрыть
let sy0 = null;
const card = $('.sheet-card');
card.addEventListener('touchstart', e => { if ($('#sheet-body').scrollTop <= 0) sy0 = e.touches[0].clientY; }, { passive: true });
card.addEventListener('touchmove', e => {
  if (sy0 === null) return;
  const dy = e.touches[0].clientY - sy0;
  if (dy > 0) { card.style.transition = 'none'; card.style.transform = `translateY(${dy}px)`; }
}, { passive: true });
card.addEventListener('touchend', e => {
  if (sy0 === null) return;
  const dy = e.changedTouches[0].clientY - sy0; sy0 = null;
  card.style.transition = ''; card.style.transform = '';
  if (dy > 110) closeSheet();
}, { passive: true });

// новый день, пока приложение открыто
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && today() !== lastDay) { lastDay = today(); calMonth = lastDay.slice(0, 7); render(); }
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', render);

// повторно спрашивать код, если приложение было свёрнуто больше минуты
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60e3 && $('#lock').hidden) checkLock();
});

/* ---------- старт ---------- */
if (['today', 'cal', 'stats', 'set'].includes(location.hash.slice(1))) tab = location.hash.slice(1);
render();
checkLock();
if (location.hash === '#day' && S) openDay(today());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
