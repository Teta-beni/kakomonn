/* 過去問ノート
   データはこの端末の localStorage にだけ保存する。サーバーには何も送らない。 */
(() => {
  'use strict';

  const STORAGE_KEY = 'kakomon-note:v1';
  const SCHEMA = 1;
  const APP_ID = 'kakomon-note';
  const DEFAULT_SUBJECTS = ['英語', '国語', '世界史', '日本史', '数学', '総合'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- データ ----------

  function emptyState() {
    return {
      schema: SCHEMA,
      students: [],
      records: [],
      meta: { lastBackup: null, lastChange: null, currentStudentId: null, homeNoticeClosed: false, persistAsked: false },
    };
  }

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeStudent(s) {
    if (!s || typeof s !== 'object') return null;
    const name = String(s.name ?? '').trim().slice(0, 20);
    if (!s.id || !name) return null;
    return { id: String(s.id), name, created: s.created || new Date().toISOString() };
  }

  function normalizeRecord(r) {
    if (!r || typeof r !== 'object') return null;
    const score = toNum(r.score);
    const max = toNum(r.max);
    const year = toNum(r.year);
    const school = String(r.school ?? '').trim();
    const subject = String(r.subject ?? '').trim();
    const date = String(r.date ?? '');
    if (!r.id || !r.studentId || !school || !subject || score === null || !max || max <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {
      id: String(r.id),
      studentId: String(r.studentId),
      school,
      year: year === null ? null : Math.round(year),
      subject,
      date,
      score,
      max,
      pass: toNum(r.pass),
      created: r.created || new Date().toISOString(),
      updated: r.updated || r.created || new Date().toISOString(),
    };
  }

  function normalize(d) {
    const s = emptyState();
    if (!d || typeof d !== 'object') return s;
    s.students = (Array.isArray(d.students) ? d.students : []).map(normalizeStudent).filter(Boolean);
    const ids = new Set(s.students.map((x) => x.id));
    s.records = (Array.isArray(d.records) ? d.records : []).map(normalizeRecord).filter((r) => r && ids.has(r.studentId));
    if (d.meta && typeof d.meta === 'object') Object.assign(s.meta, d.meta);
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : emptyState();
    } catch (e) {
      return emptyState();
    }
  }

  let storageOk = true;
  function save({ changed = true } = {}) {
    if (changed) state.meta.lastChange = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
      toast('この端末に保存できませんでした。プライベートブラウズをオフにしてください。');
    }
    if (!state.meta.persistAsked && navigator.storage && navigator.storage.persist) {
      state.meta.persistAsked = true;
      navigator.storage.persist().catch(() => {});
    }
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  let state = load();

  let hideActiveTooltip = null;

  const ui = {
    tab: 'records',
    editingRecordId: null,
    editingStudentId: null,
    chartSchool: null,
    chartSubject: null,
    showTable: false,
  };

  // ---------- 小さな道具 ----------

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    return node;
  }

  function fmt(n) {
    if (n === null || n === undefined) return '';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  function pct(score, max) {
    return (score / max) * 100;
  }

  function fmtPct(p, digits = 0) {
    const m = Math.pow(10, digits);
    return String(Math.round(p * m) / m) + '%';
  }

  function todayISO() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtDate(iso, { withYear = 'auto' } = {}) {
    const [y, m, d] = iso.split('-').map(Number);
    const thisYear = new Date().getFullYear();
    if (withYear === true || (withYear === 'auto' && y !== thisYear)) return `${y}/${m}/${d}`;
    return `${m}/${d}`;
  }

  function yearLabel(y) {
    return y ? `${y}年度` : '年度なし';
  }

  function daysSince(iso) {
    if (!iso) return Infinity;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // 記録を並べる順：解いた日 → 入力した順
  function byDateAsc(a, b) {
    return a.date.localeCompare(b.date) || a.created.localeCompare(b.created);
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // 手書きの丸（赤ペン）。記録ごとに少しずつ形が違う
  function penCircle(seedStr) {
    let seed = hashStr(seedStr);
    const r = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 4294967296) * 2 - 1; // -1〜1
    };
    const j = (v, amt) => (v + r() * amt).toFixed(1);
    const d = [
      `M ${j(24, 3)} ${j(9, 2)}`,
      `C ${j(48, 4)} ${j(1, 2)}, ${j(84, 3)} ${j(4, 2)}, ${j(95, 2)} ${j(24, 3)}`,
      `C ${j(103, 2)} ${j(42, 3)}, ${j(84, 3)} ${j(58, 2)}, ${j(50, 4)} ${j(58, 2)}`,
      `C ${j(18, 3)} ${j(58, 2)}, ${j(1, 2)} ${j(46, 3)}, ${j(4, 2)} ${j(29, 3)}`,
      `C ${j(7, 2)} ${j(15, 2)}, ${j(24, 3)} ${j(6, 2)}, ${j(44, 4)} ${j(5, 2)}`,
    ].join(' ');
    const s = svg('svg', { viewBox: '0 0 100 60', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    s.append(svg('path', { d }));
    return s;
  }

  // ---------- 生徒 ----------

  function currentStudent() {
    return state.students.find((s) => s.id === state.meta.currentStudentId) || state.students[0] || null;
  }

  function setCurrentStudent(id) {
    state.meta.currentStudentId = id;
    ui.chartSchool = null;
    ui.chartSubject = null;
    save({ changed: false });
    renderAll();
  }

  function recordsOf(studentId) {
    return state.records.filter((r) => r.studentId === studentId);
  }

  function renderStudentChips() {
    const box = $('studentChips');
    box.replaceChildren();
    const cur = currentStudent();
    for (const s of state.students) {
      const selected = cur && s.id === cur.id;
      box.append(
        el('button', {
          type: 'button',
          class: 'chip',
          role: 'tab',
          'aria-selected': selected ? 'true' : 'false',
          text: s.name,
          onclick: () => setCurrentStudent(s.id),
        })
      );
    }
  }

  function openStudentSheet(studentId = null) {
    ui.editingStudentId = studentId;
    const form = $('studentForm');
    form.reset();
    $('studentError').textContent = '';
    const s = studentId ? state.students.find((x) => x.id === studentId) : null;
    $('studentSheetTitle').textContent = s ? '名前を変える' : '生徒を追加する';
    $('saveStudentBtn').textContent = s ? '保存する' : '追加する';
    if (s) form.elements.name.value = s.name;
    $('studentSheet').showModal();
    form.elements.name.focus();
  }

  function submitStudent(e) {
    e.preventDefault();
    const name = $('studentForm').elements.name.value.trim();
    if (!name) {
      $('studentError').textContent = '名前を入れてください。';
      return;
    }
    if (ui.editingStudentId) {
      const s = state.students.find((x) => x.id === ui.editingStudentId);
      if (s) s.name = name.slice(0, 20);
      save();
      toast('名前を変えました');
    } else {
      const s = { id: uid(), name: name.slice(0, 20), created: new Date().toISOString() };
      state.students.push(s);
      state.meta.currentStudentId = s.id;
      save();
      toast(`${s.name}を追加しました`);
    }
    $('studentSheet').close();
    renderAll();
  }

  function deleteStudent(id) {
    const s = state.students.find((x) => x.id === id);
    if (!s) return;
    const n = recordsOf(id).length;
    const msg = n ? `${s.name}と、その記録${n}件を削除します。元に戻せません。よろしいですか？` : `${s.name}を削除します。よろしいですか？`;
    if (!confirm(msg)) return;
    state.students = state.students.filter((x) => x.id !== id);
    state.records = state.records.filter((r) => r.studentId !== id);
    if (state.meta.currentStudentId === id) state.meta.currentStudentId = state.students[0]?.id ?? null;
    save();
    toast(`${s.name}を削除しました`);
    renderAll();
  }

  // ---------- 記録一覧 ----------

  function renderRecords() {
    const list = $('recordList');
    list.replaceChildren();
    const cur = currentStudent();

    if (!cur) {
      list.append(
        el('div', { class: 'empty' }, [
          el('p', { class: 'empty-title', text: 'ようこそ' }),
          el('p', { text: 'まず、記録をつける生徒を追加しましょう。自分で使う場合は、自分の名前を入れてください。' }),
          el('button', { type: 'button', class: 'btn btn-primary', text: '生徒を追加する', onclick: () => openStudentSheet() }),
        ])
      );
      renderNotices([]);
      return;
    }

    const recs = recordsOf(cur.id);
    renderNotices(recs);

    if (!recs.length) {
      list.append(
        el('div', { class: 'empty' }, [
          el('p', { class: 'empty-title', text: `${cur.name}の記録はまだありません` }),
          el('p', { text: '過去問を解いたら、志望校・年度・点数を記録しましょう。' }),
          el('button', { type: 'button', class: 'btn btn-primary', text: '記録する', onclick: () => openRecordSheet() }),
        ])
      );
      return;
    }

    // 志望校ごとにまとめる（最近解いた志望校が上）
    const groups = new Map();
    for (const r of recs) {
      if (!groups.has(r.school)) groups.set(r.school, []);
      groups.get(r.school).push(r);
    }
    const sorted = [...groups.entries()]
      .map(([school, rs]) => [school, rs.sort((a, b) => byDateAsc(b, a))])
      .sort((a, b) => byDateAsc(b[1][0], a[1][0]));

    for (const [school, rs] of sorted) {
      const ul = el('ul', { class: 'records' });
      for (const r of rs) ul.append(recordRow(r));
      list.append(
        el('section', { class: 'school-group' }, [
          el('div', { class: 'school-head' }, [
            el('h2', { class: 'school-name', text: school }),
            el('span', { class: 'school-count', text: `${rs.length}回` }),
          ]),
          ul,
        ])
      );
    }
  }

  function statusFor(r) {
    if (r.pass === null) return null;
    const diff = r.score - r.pass;
    if (diff >= 0) {
      return el('span', { class: 'status status-good' }, [
        el('span', { class: 'status-icon', 'aria-hidden': 'true', text: '✓' }),
        `合格最低点を${fmt(diff)}点上回る`,
      ]);
    }
    return el('span', { class: 'status status-short' }, [
      el('span', { class: 'status-icon', 'aria-hidden': 'true', text: '!' }),
      `合格最低点まであと${fmt(-diff)}点`,
    ]);
  }

  function recordRow(r) {
    const p = pct(r.score, r.max);
    const label = `${yearLabel(r.year)} ${r.subject}、${fmt(r.score)}点（満点${fmt(r.max)}点、${fmtPct(p)}）。解いた日 ${fmtDate(r.date, { withYear: true })}。タップで編集`;
    const score = el('span', { class: 'score' }, [
      penCircle(r.id),
      el('span', { class: 'score-num' }, [fmt(r.score), el('span', { class: 'score-max', text: `/${fmt(r.max)}` })]),
    ]);
    const scoreWrap = el('span', { style: 'display:grid;justify-items:center' }, [score, el('span', { class: 'score-pct', text: fmtPct(p) })]);
    return el('li', { class: 'record' }, [
      el('button', { type: 'button', class: 'record-btn', 'aria-label': label, onclick: () => openRecordSheet(r.id) }, [
        el('span', { class: 'record-main' }, [
          el('span', { class: 'record-year', text: yearLabel(r.year) }),
          el('span', { class: 'record-subject', text: r.subject }),
          el('span', { class: 'record-meta', text: `${fmtDate(r.date)} に解いた` }),
          statusFor(r),
        ]),
        scoreWrap,
      ]),
    ]);
  }

  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function renderNotices(recs) {
    // バックアップのおすすめ
    const changedSinceBackup = !state.meta.lastBackup || (state.meta.lastChange && state.meta.lastChange > state.meta.lastBackup);
    const total = state.records.length;
    let text = '';
    if (total && changedSinceBackup) {
      if (!state.meta.lastBackup && total >= 5) text = 'まだバックアップしていません。記録が消えたときのために書き出しておきましょう。';
      else if (state.meta.lastBackup && daysSince(state.meta.lastBackup) >= 14) text = `最後のバックアップから${daysSince(state.meta.lastBackup)}日たっています。`;
    }
    $('backupNotice').hidden = !text;
    $('backupNoticeText').textContent = text;

    // iPhone：ホーム画面に追加のおすすめ
    $('homeNotice').hidden = !(recs.length && isIOS() && !isStandalone() && !state.meta.homeNoticeClosed);
  }

  // ---------- 記録の入力 ----------

  function fillYearOptions(select, selected) {
    select.replaceChildren();
    const now = new Date().getFullYear();
    const years = [];
    for (let y = now + 1; y >= now - 15; y--) years.push(y);
    if (selected && !years.includes(selected)) years.push(selected);
    years.sort((a, b) => b - a);
    for (const y of years) select.append(el('option', { value: String(y), text: `${y}年度` }));
    select.value = String(selected || now);
  }

  function fillDatalists() {
    const schools = [...new Set([...state.records].sort((a, b) => byDateAsc(b, a)).map((r) => r.school))];
    $('schoolList').replaceChildren(...schools.map((s) => el('option', { value: s })));
    const subjects = [...new Set([...DEFAULT_SUBJECTS, ...state.records.map((r) => r.subject)])];
    $('subjectList').replaceChildren(...subjects.map((s) => el('option', { value: s })));
  }

  function openRecordSheet(recordId = null) {
    const cur = currentStudent();
    if (!cur) {
      openStudentSheet();
      return;
    }
    ui.editingRecordId = recordId;
    const form = $('recordForm');
    form.reset();
    $('formError').textContent = '';
    fillDatalists();
    const f = form.elements;
    const r = recordId ? state.records.find((x) => x.id === recordId) : null;

    if (r) {
      $('recordSheetTitle').textContent = `${cur.name}の記録を編集`;
      $('saveRecordBtn').textContent = '保存する';
      $('deleteRecordBtn').hidden = false;
      f.school.value = r.school;
      fillYearOptions(f.year, r.year);
      f.subject.value = r.subject;
      f.date.value = r.date;
      f.score.value = fmt(r.score);
      f.max.value = fmt(r.max);
      f.pass.value = r.pass === null ? '' : fmt(r.pass);
    } else {
      $('recordSheetTitle').textContent = `${cur.name}の記録をつける`;
      $('saveRecordBtn').textContent = '記録する';
      $('deleteRecordBtn').hidden = true;
      // 前回の入力を初期値にして、入力の手間を減らす
      const last = recordsOf(cur.id).sort((a, b) => byDateAsc(b, a))[0];
      f.school.value = last ? last.school : '';
      fillYearOptions(f.year, last ? last.year : null);
      f.subject.value = last ? last.subject : '';
      f.max.value = last ? fmt(last.max) : '';
      f.date.value = todayISO();
    }
    $('recordSheet').showModal();
    if (!r && !f.school.value) f.school.focus();
  }

  // 志望校・科目を変えたら、同じ組み合わせの前回の満点を入れる
  function suggestMax() {
    if (ui.editingRecordId) return;
    const f = $('recordForm').elements;
    const school = f.school.value.trim();
    const subject = f.subject.value.trim();
    if (!school || !subject) return;
    const prev = state.records.filter((r) => r.school === school && r.subject === subject).sort((a, b) => byDateAsc(b, a))[0];
    if (prev) f.max.value = fmt(prev.max);
  }

  function submitRecord(e) {
    e.preventDefault();
    const f = $('recordForm').elements;
    const err = (m) => {
      $('formError').textContent = m;
    };
    const school = f.school.value.trim();
    const subject = f.subject.value.trim();
    const year = toNum(f.year.value);
    const date = f.date.value;
    const score = toNum(f.score.value);
    const max = toNum(f.max.value);
    const pass = toNum(f.pass.value);

    if (!school) return err('志望校を入れてください。');
    if (!subject) return err('科目を入れてください。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('解いた日を入れてください。');
    if (score === null || score < 0) return err('得点を0以上の数で入れてください。');
    if (max === null || max <= 0) return err('満点を入れてください。');
    if (score > max) return err('得点が満点を超えています。');
    if (f.pass.value.trim() !== '' && (pass === null || pass < 0 || pass > max)) return err('合格最低点は0から満点までの数で入れてください。');

    const now = new Date().toISOString();
    if (ui.editingRecordId) {
      const r = state.records.find((x) => x.id === ui.editingRecordId);
      if (r) Object.assign(r, { school, subject, year, date, score, max, pass, updated: now });
      save();
      toast('保存しました');
    } else {
      const cur = currentStudent();
      state.records.push({ id: uid(), studentId: cur.id, school, subject, year, date, score, max, pass, created: now, updated: now });
      save();
      toast('記録しました');
    }
    ui.chartSchool = school;
    ui.chartSubject = subject;
    $('recordSheet').close();
    renderAll();
  }

  function deleteRecord() {
    const r = state.records.find((x) => x.id === ui.editingRecordId);
    if (!r) return;
    if (!confirm(`${r.school} ${yearLabel(r.year)} ${r.subject}の記録を削除します。よろしいですか？`)) return;
    state.records = state.records.filter((x) => x.id !== r.id);
    save();
    $('recordSheet').close();
    toast('削除しました');
    renderAll();
  }

  // ---------- グラフ ----------

  function renderChartView() {
    const area = $('chartArea');
    area.replaceChildren();
    const schoolSel = $('chartSchool');
    const subjectSel = $('chartSubject');
    const cur = currentStudent();
    const recs = cur ? recordsOf(cur.id) : [];

    if (!recs.length) {
      schoolSel.replaceChildren();
      subjectSel.replaceChildren();
      schoolSel.disabled = subjectSel.disabled = true;
      area.append(
        el('div', { class: 'empty' }, [
          el('p', { class: 'empty-title', text: 'グラフにする記録がまだありません' }),
          el('p', { text: cur ? '記録をつけると、点数の推移がここに出ます。' : 'まず生徒を追加しましょう。' }),
          el('button', { type: 'button', class: 'btn btn-primary', text: cur ? '記録する' : '生徒を追加する', onclick: () => (cur ? openRecordSheet() : openStudentSheet()) }),
        ])
      );
      return;
    }
    schoolSel.disabled = subjectSel.disabled = false;

    const recent = [...recs].sort((a, b) => byDateAsc(b, a));
    const schools = [...new Set(recent.map((r) => r.school))];
    if (!schools.includes(ui.chartSchool)) ui.chartSchool = schools[0];
    schoolSel.replaceChildren(...schools.map((s) => el('option', { value: s, text: s })));
    schoolSel.value = ui.chartSchool;

    const subjects = [...new Set(recent.filter((r) => r.school === ui.chartSchool).map((r) => r.subject))];
    if (!subjects.includes(ui.chartSubject)) ui.chartSubject = subjects[0];
    subjectSel.replaceChildren(...subjects.map((s) => el('option', { value: s, text: s })));
    subjectSel.value = ui.chartSubject;

    const pts = recs.filter((r) => r.school === ui.chartSchool && r.subject === ui.chartSubject).sort(byDateAsc);
    area.append(statTiles(pts), chartCard(pts), tableBlock(pts));
  }

  function statTiles(pts) {
    const ps = pts.map((r) => pct(r.score, r.max));
    const latest = pts[pts.length - 1];
    const latestP = ps[ps.length - 1];
    const avg = ps.reduce((a, b) => a + b, 0) / ps.length;
    const bestI = ps.indexOf(Math.max(...ps));
    let latestSub = `${yearLabel(latest.year)}・${fmtDate(latest.date)}`;
    if (latest.pass !== null) {
      const d = latest.score - latest.pass;
      latestSub = d >= 0 ? `合格最低点 +${fmt(d)}点` : `合格最低点まで あと${fmt(-d)}点`;
    }
    const tile = (label, value, sub) =>
      el('div', { class: 'stat' }, [el('span', { class: 'stat-label', text: label }), el('span', { class: 'stat-value', text: value }), el('span', { class: 'stat-sub', text: sub })]);
    return el('div', { class: 'stats' }, [
      tile('最新', fmtPct(latestP), latestSub),
      tile('平均', fmtPct(avg), `${pts.length}回分`),
      tile('最高', fmtPct(ps[bestI]), yearLabel(pts[bestI].year)),
    ]);
  }

  function chartCard(pts) {
    const hasPass = pts.some((r) => r.pass !== null);
    const card = el('div', { class: 'chart-card' });
    card.append(
      el('h3', { class: 'chart-title', text: hasPass ? '得点率と合格最低点の推移' : '得点率の推移' }),
      el('p', { class: 'chart-sub', text: `${ui.chartSchool}・${ui.chartSubject}｜左から解いた順` })
    );
    if (hasPass) {
      card.append(
        el('div', { class: 'legend' }, [
          el('span', { class: 'legend-item' }, [el('span', { class: 'legend-key s1' }), '得点率']),
          el('span', { class: 'legend-item' }, [el('span', { class: 'legend-key s2' }), '合格最低点']),
        ])
      );
    }

    const W = 340;
    const H = 220;
    const m = { l: 38, r: 40, t: 12, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = pts.length;
    const x = (i) => (n === 1 ? m.l + iw / 2 : m.l + (iw * i) / (n - 1));
    const y = (p) => m.t + ih - (ih * Math.max(0, Math.min(100, p))) / 100;

    const s = svg('svg', {
      class: 'chart-svg',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `${ui.chartSchool} ${ui.chartSubject}の得点率の推移。${n}回分。最新は${fmtPct(pct(pts[n - 1].score, pts[n - 1].max))}。`,
    });

    // 目盛り（0〜100%）
    for (let t = 0; t <= 100; t += 20) {
      s.append(svg('line', { class: t === 0 ? 'baseline' : 'gridline', x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
      s.append(svg('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', text: `${t}%` }));
    }

    // 横軸：解いた日（多いときは間引く。最初と最後は必ず出す）
    const step = Math.max(1, Math.ceil(n / 5));
    const labelIdx = new Set([0, n - 1]);
    for (let i = step; i < n - 1; i += step) {
      if (n - 1 - i >= Math.ceil(step / 2)) labelIdx.add(i);
    }
    for (const i of labelIdx) {
      const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      s.append(svg('text', { x: x(i), y: H - 8, 'text-anchor': anchor, text: fmtDate(pts[i].date) }));
    }

    // 合格最低点（ある回だけ。途切れたら線も切る）
    if (hasPass) {
      let seg = [];
      const flush = () => {
        if (seg.length > 1) s.append(svg('polyline', { class: 'line s2', points: seg.join(' ') }));
        seg = [];
      };
      pts.forEach((r, i) => {
        if (r.pass === null) return flush();
        seg.push(`${x(i).toFixed(1)},${y(pct(r.pass, r.max)).toFixed(1)}`);
      });
      flush();
      pts.forEach((r, i) => {
        if (r.pass !== null) s.append(svg('circle', { class: 'dot s2', cx: x(i), cy: y(pct(r.pass, r.max)), r: 4 }));
      });
    }

    // 得点率
    if (n > 1) s.append(svg('polyline', { class: 'line s1', points: pts.map((r, i) => `${x(i).toFixed(1)},${y(pct(r.score, r.max)).toFixed(1)}`).join(' ') }));
    pts.forEach((r, i) => s.append(svg('circle', { class: 'dot s1', cx: x(i), cy: y(pct(r.score, r.max)), r: 4.5 })));

    // 最新の値だけ線の端にラベル
    const lastP = pct(pts[n - 1].score, pts[n - 1].max);
    s.append(svg('text', { class: 'end-label', x: x(n - 1) + 8, y: y(lastP) + 4, text: fmtPct(lastP) }));

    // ホバー・タップ用
    const cross = svg('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    s.append(cross);
    const hit = svg('rect', { x: m.l - 14, y: 0, width: iw + 28, height: H, fill: 'transparent', tabindex: '0', 'aria-label': '点ごとの値を見る（左右キーで移動）' });
    s.append(hit);
    card.append(s);

    // スマホではグラフに重ねると線が隠れるので、値はグラフの上の決まった場所に出す
    const hint = () => el('p', { class: 'readout-hint', text: 'グラフをタップすると、その回の点数が出ます' });
    const tip = el('div', { class: 'readout', 'aria-live': 'polite' }, hint());
    card.insertBefore(tip, s);

    let active = -1;
    const show = (i) => {
      active = i;
      const r = pts[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      const rows = [
        el('div', { class: 'tooltip-head', text: `${fmtDate(r.date, { withYear: true })}に解いた・${yearLabel(r.year)}` }),
        el('div', { class: 'tooltip-row' }, [
          el('span', { class: 'tooltip-key', style: 'border-color:var(--series-1)' }),
          el('strong', { text: fmtPct(pct(r.score, r.max), 1) }),
          el('span', { text: `${fmt(r.score)}/${fmt(r.max)}点` }),
        ]),
      ];
      if (r.pass !== null) {
        rows.push(
          el('div', { class: 'tooltip-row' }, [
            el('span', { class: 'tooltip-key', style: 'border-color:var(--series-2)' }),
            el('strong', { text: fmtPct(pct(r.pass, r.max), 1) }),
            el('span', { text: `合格最低点 ${fmt(r.pass)}点` }),
          ])
        );
      }
      tip.replaceChildren(...rows);
    };
    const hide = () => {
      active = -1;
      cross.setAttribute('visibility', 'hidden');
      tip.replaceChildren(hint());
    };
    const nearest = (clientX) => {
      const sr = s.getBoundingClientRect();
      const vx = ((clientX - sr.left) / sr.width) * W;
      let best = 0;
      let bd = Infinity;
      pts.forEach((_, i) => {
        const d = Math.abs(x(i) - vx);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    hit.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    hit.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    hit.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    hit.addEventListener('focus', () => show(n - 1));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(Math.max(0, (active < 0 ? n - 1 : active) - 1));
      else if (e.key === 'ArrowRight') show(Math.min(n - 1, (active < 0 ? 0 : active) + 1));
      else if (e.key === 'Escape') hide();
      else return;
      e.preventDefault();
    });
    // グラフの外をタップしたら閉じる（リスナーは起動時に1つだけ登録）
    hideActiveTooltip = (target) => {
      if (!card.contains(target)) hide();
    };
    return card;
  }

  function tableBlock(pts) {
    const wrap = el('div', { class: 'table-toggle' });
    const btn = el('button', { type: 'button', class: 'btn-text', 'aria-expanded': ui.showTable ? 'true' : 'false', text: ui.showTable ? '表を閉じる' : '表で見る' });
    btn.addEventListener('click', () => {
      ui.showTable = !ui.showTable;
      renderChartView();
    });
    wrap.append(btn);
    if (ui.showTable) {
      const hasPass = pts.some((r) => r.pass !== null);
      const head = ['解いた日', '年度', '得点', '得点率'].concat(hasPass ? ['合格最低点'] : []);
      const table = el('table', { class: 'data-table' }, [
        el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))),
        el(
          'tbody',
          {},
          [...pts].reverse().map((r) =>
            el(
              'tr',
              {},
              [fmtDate(r.date, { withYear: true }), yearLabel(r.year), `${fmt(r.score)}/${fmt(r.max)}`, fmtPct(pct(r.score, r.max), 1)]
                .concat(hasPass ? [r.pass === null ? '—' : fmt(r.pass)] : [])
                .map((v) => el('td', { text: v }))
            )
          )
        ),
      ]);
      wrap.append(table);
    }
    return wrap;
  }

  // ---------- 設定・バックアップ ----------

  function renderSettings() {
    const ul = $('studentAdmin');
    ul.replaceChildren();
    if (!state.students.length) {
      ul.append(el('li', {}, el('span', { class: 'help', text: 'まだ生徒がいません。' })));
    }
    for (const s of state.students) {
      ul.append(
        el('li', {}, [
          el('span', { class: 'name' }, [s.name, el('span', { class: 'count', text: `${recordsOf(s.id).length}件` })]),
          el('span', { class: 'actions' }, [
            el('button', { type: 'button', class: 'btn-text', text: '名前を変える', onclick: () => openStudentSheet(s.id) }),
            el('button', { type: 'button', class: 'btn-text danger', text: '削除', onclick: () => deleteStudent(s.id) }),
          ]),
        ])
      );
    }
    $('lastBackupText').textContent = state.meta.lastBackup
      ? `最後のバックアップ：${fmtDate(state.meta.lastBackup.slice(0, 10), { withYear: true })}`
      : 'まだバックアップしていません。';
    const empty = !state.records.length && !state.students.length;
    $('exportBtn').disabled = empty;
    $('csvBtn').disabled = !state.records.length;
  }

  function stamp() {
    return todayISO().replace(/-/g, '');
  }

  async function deliverFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    // スマホなら共有シートでLINEやファイルに送れる
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  async function exportBackup() {
    const data = {
      app: APP_ID,
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      students: state.students,
      records: state.records,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const ok = await deliverFile(blob, `kakomon-backup-${stamp()}.json`);
    if (ok) {
      state.meta.lastBackup = new Date().toISOString();
      save({ changed: false });
      toast('バックアップを書き出しました');
      renderAll();
    }
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        toast('このファイルは読み込めませんでした。');
        return;
      }
      if (!data || data.app !== APP_ID || !Array.isArray(data.students) || !Array.isArray(data.records)) {
        toast('このファイルは過去問ノートのバックアップではありません。');
        return;
      }
      const inc = normalize(data);
      const idMap = new Map();
      let addedStudents = 0;
      for (const s of inc.students) {
        if (state.students.some((x) => x.id === s.id)) {
          idMap.set(s.id, s.id);
          continue;
        }
        const same = state.students.find((x) => x.name === s.name);
        if (same && confirm(`「${s.name}」はすでにいます。同じ生徒として記録をまとめますか？\n（キャンセルすると別の生徒として追加します）`)) {
          idMap.set(s.id, same.id);
          continue;
        }
        state.students.push(s);
        idMap.set(s.id, s.id);
        addedStudents++;
      }
      let added = 0;
      let updated = 0;
      for (const r of inc.records) {
        r.studentId = idMap.get(r.studentId) || r.studentId;
        const i = state.records.findIndex((x) => x.id === r.id);
        if (i < 0) {
          state.records.push(r);
          added++;
        } else if (r.updated > state.records[i].updated) {
          state.records[i] = r;
          updated++;
        }
      }
      if (!state.meta.currentStudentId && state.students[0]) state.meta.currentStudentId = state.students[0].id;
      save();
      if (!addedStudents && !added && !updated) {
        toast('新しい記録はありませんでした（すべて読み込み済みです）');
      } else {
        const parts = [];
        if (addedStudents) parts.push(`生徒${addedStudents}人`);
        if (added) parts.push(`記録${added}件を追加`);
        if (updated) parts.push(`記録${updated}件を更新`);
        toast(parts.join('・') + 'しました');
      }
      renderAll();
    };
    reader.readAsText(file);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async function exportCSV() {
    const name = new Map(state.students.map((s) => [s.id, s.name]));
    const rows = [['生徒', '志望校', '年度', '科目', '解いた日', '得点', '満点', '得点率(%)', '合格最低点']];
    const recs = [...state.records].sort((a, b) => (name.get(a.studentId) || '').localeCompare(name.get(b.studentId) || '', 'ja') || a.school.localeCompare(b.school, 'ja') || byDateAsc(a, b));
    for (const r of recs) {
      rows.push([name.get(r.studentId) || '', r.school, r.year ?? '', r.subject, r.date, fmt(r.score), fmt(r.max), fmt(Math.round(pct(r.score, r.max) * 10) / 10), r.pass === null ? '' : fmt(r.pass)]);
    }
    const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    await deliverFile(new Blob([csv], { type: 'text/csv' }), `kakomon-${stamp()}.csv`);
  }

  // ---------- タブ ----------

  function setTab(tab) {
    ui.tab = tab;
    for (const b of document.querySelectorAll('.tabbar [role="tab"]')) b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    $('view-records').hidden = tab !== 'records';
    $('view-chart').hidden = tab !== 'chart';
    $('view-settings').hidden = tab !== 'settings';
    $('addRecordBtn').hidden = tab === 'settings' || !currentStudent();
    window.scrollTo(0, 0);
    renderAll();
  }

  function renderAll() {
    const cur = currentStudent();
    if (cur && state.meta.currentStudentId !== cur.id) state.meta.currentStudentId = cur.id;
    renderStudentChips();
    $('addRecordBtn').hidden = ui.tab === 'settings' || !cur;
    if (ui.tab === 'records') renderRecords();
    if (ui.tab === 'chart') renderChartView();
    if (ui.tab === 'settings') renderSettings();
  }

  // ---------- 起動 ----------

  function bind() {
    for (const b of document.querySelectorAll('.tabbar [role="tab"]')) b.addEventListener('click', () => setTab(b.dataset.tab));
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) setTab(go.dataset.go);
      const close = e.target.closest('[data-close]');
      if (close) close.closest('dialog').close();
    });
    for (const d of document.querySelectorAll('dialog')) {
      d.addEventListener('click', (e) => {
        if (e.target === d) d.close(); // 背景タップで閉じる
      });
    }
    $('addStudentBtn').addEventListener('click', () => openStudentSheet());
    $('addRecordBtn').addEventListener('click', () => openRecordSheet());
    $('recordForm').addEventListener('submit', submitRecord);
    $('studentForm').addEventListener('submit', submitStudent);
    $('deleteRecordBtn').addEventListener('click', deleteRecord);
    const f = $('recordForm').elements;
    f.school.addEventListener('change', suggestMax);
    f.subject.addEventListener('change', suggestMax);
    $('chartSchool').addEventListener('change', (e) => {
      ui.chartSchool = e.target.value;
      ui.chartSubject = null;
      renderChartView();
    });
    $('chartSubject').addEventListener('change', (e) => {
      ui.chartSubject = e.target.value;
      renderChartView();
    });
    $('exportBtn').addEventListener('click', exportBackup);
    $('csvBtn').addEventListener('click', exportCSV);
    $('importInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importBackup(file);
      e.target.value = '';
    });
    $('homeNoticeClose').addEventListener('click', () => {
      state.meta.homeNoticeClosed = true;
      save({ changed: false });
      renderAll();
    });
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (hideActiveTooltip) hideActiveTooltip(e.target);
      },
      { passive: true }
    );
    // 別のタブで変更されたら読み直す
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        state = load();
        renderAll();
      }
    });
  }

  bind();
  renderAll();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
