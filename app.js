'use strict';

// ---------- 項目の定義 ----------
// key: 保存名 / name: 表示名 / unit: 単位 / dec: 小数の桁 / min,max: 読み取り結果の妥当な範囲
// label: 用紙の項目名（読み取り用）/ main: 画面上部のよく見る項目
const FIELDS = [
  { key: 'weight', name: '体重', unit: 'kg', dec: 1, min: 20, max: 250, main: true, label: /合計体重|体重\(k/ },
  { key: 'pbf', name: '体脂肪率', unit: '%', dec: 1, min: 2, max: 70, main: true, label: /体脂肪率/ },
  { key: 'lean', name: '筋肉量', unit: 'kg', dec: 1, min: 15, max: 150, main: true, label: /筋肉量/ },
  { key: 'fat', name: '体脂肪量', unit: 'kg', dec: 1, min: 1, max: 120, main: true, label: /(?<!別)体脂肪量/ },
  { key: 'bmi', name: 'BMI', unit: '', dec: 1, min: 10, max: 60, main: true, label: /BMI|B\d*M\d*I/ },
  { key: 'vfl', name: '内臓脂肪レベル', unit: '', dec: 0, min: 1, max: 30, label: /内臓脂肪レベル|内臓脂肪/ },
  { key: 'score', name: 'InBody点数', unit: '点', dec: 0, min: 1, max: 120, label: /InBody点数|点数/ },
  { key: 'water', name: '体水分量', unit: 'L', dec: 1, min: 15, max: 120, label: /体水分量/ },
  { key: 'protein', name: 'タンパク質量', unit: 'kg', dec: 1, min: 3, max: 40, label: /タン.{0,3}質量/ },
  { key: 'mineral', name: 'ミネラル量', unit: 'kg', dec: 2, min: 1, max: 15, label: /ミネラル量/ },
  { key: 'skeletal', name: '骨格筋量', unit: 'kg', dec: 1, min: 10, max: 80, label: /骨格筋量/ },
  { key: 'ffm', name: '除脂肪量', unit: 'kg', dec: 1, min: 15, max: 150, label: /除脂肪量/ },
  { key: 'bmr', name: '基礎代謝量', unit: 'kcal', dec: 0, min: 600, max: 4000, label: /基礎代謝量|礎代謝|論量/ },
  { key: 'waist', name: '腹囲', unit: 'cm', dec: 1, min: 40, max: 200, label: /腹囲|腹図/ },
  { key: 'smi', name: '骨格筋指数(SMI)', unit: 'kg/m²', dec: 1, min: 3, max: 15, label: /骨格筋指数|格筋指数|SMI/ },
  { key: 'ffmi', name: '除脂肪指数(FFMI)', unit: 'kg/m²', dec: 1, min: 10, max: 35, label: /除脂肪指数/ },
  { key: 'fmi', name: '体脂肪指数(FMI)', unit: 'kg/m²', dec: 1, min: 0.5, max: 30, label: /体脂肪指数/ },
  { key: 'smmwt', name: '骨格筋率', unit: '%', dec: 1, min: 20, max: 70, label: /骨格筋率/ },
];
const SEGMENTS = [
  ['seg_lean_la', '筋肉量 左腕'], ['seg_lean_ra', '筋肉量 右腕'], ['seg_lean_tr', '筋肉量 体幹'],
  ['seg_lean_ll', '筋肉量 左脚'], ['seg_lean_rl', '筋肉量 右脚'],
  ['seg_fat_la', '体脂肪量 左腕'], ['seg_fat_ra', '体脂肪量 右腕'], ['seg_fat_tr', '体脂肪量 体幹'],
  ['seg_fat_ll', '体脂肪量 左脚'], ['seg_fat_rl', '体脂肪量 右脚'],
].map(([key, name]) => ({ key, name, unit: 'kg', dec: 2, min: 0, max: 80 }));
const ALL = [...FIELDS, ...SEGMENTS];
const META = Object.fromEntries(ALL.map(f => [f.key, f]));

// ---------- 保存 ----------
const KEY_REC = 'taisosei.records.v1', KEY_GOAL = 'taisosei.goals.v1';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { alert('保存できませんでした。空き容量を確認してください。'); } };
let records = load(KEY_REC, []);   // {at:'YYYY-MM-DDTHH:MM', values:{}, ranges:{key:[lo,hi]}, memo}
let goals = load(KEY_GOAL, {});
records.sort((a, b) => a.at.localeCompare(b.at));
try { navigator.storage?.persist?.(); } catch {}

const $ = s => document.querySelector(s);
const fmt = (v, key) => v == null ? '-' : Number(v).toFixed(META[key]?.dec ?? 1);
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

// ---------- タブ ----------
function showTab(t) {
  document.querySelectorAll('.tab').forEach(e => e.classList.toggle('active', e.id === 'tab-' + t));
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  const titles = { trend: '体組成ノート', add: '記録する', list: '履歴', set: '設定' };
  $('#title').textContent = titles[t];
  if (t === 'trend') renderTrend();
  if (t === 'list') renderList();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---------- 推移 ----------
let metric = 'weight', mode = 'day', chart = null;

function buildMetricUI() {
  $('#metricChips').innerHTML = FIELDS.filter(f => f.main)
    .map(f => `<button data-k="${f.key}">${f.name}</button>`).join('');
  $('#metricSel').innerHTML = FIELDS.map(f => `<option value="${f.key}">${f.name}</option>`).join('')
    + '<optgroup label="部位別">' + SEGMENTS.map(f => `<option value="${f.key}">${f.name}</option>`).join('') + '</optgroup>';
  $('#metricChips').onclick = e => { const k = e.target.dataset.k; if (k) { metric = k; renderTrend(); } };
  $('#metricSel').onchange = e => { metric = e.target.value; renderTrend(); };
  $('#rangeSel').onchange = renderTrend;
  $('#modeSeg').onclick = e => { const m = e.target.dataset.mode; if (m) { mode = m; renderTrend(); } };
}

function series(key) {
  const months = +$('#rangeSel').value;
  let cutoff = '';
  if (months) { const d = new Date(); d.setMonth(d.getMonth() - months); cutoff = d.toISOString().slice(0, 10); }
  const len = mode === 'day' ? 10 : mode === 'month' ? 7 : 4;
  const map = new Map();
  for (const r of records) {
    const v = r.values[key];
    if (v == null || r.at.slice(0, 10) < cutoff) continue;
    const label = r.at.slice(0, len);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(v);
  }
  return [...map].map(([label, vs]) => ({ label, n: vs.length, value: mode === 'day' ? vs[vs.length - 1] : avg(vs) }));
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function renderTrend() {
  const has = records.length > 0;
  $('#trendEmpty').hidden = has; $('#trendBody').hidden = !has;
  if (!has) return;
  const f = META[metric];
  document.querySelectorAll('#metricChips button').forEach(b => b.classList.toggle('on', b.dataset.k === metric));
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('#metricSel').value = metric;

  const s = series(metric);
  const vals = s.map(p => p.value);
  const u = f.unit ? `<span class="u">${f.unit}</span>` : '';
  if (!s.length) {
    $('#cards').innerHTML = '<div class="card main"><div class="k">この期間・項目のデータはありません</div></div>';
  } else {
    const last = s[s.length - 1], prev = s[s.length - 2];
    let diff = '';
    if (prev) {
      const d = last.value - prev.value, sign = d > 0 ? '+' : d < 0 ? '−' : '±';
      diff = `<div class="k ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">前回比 ${sign}${Math.abs(d).toFixed(f.dec)}${f.unit}</div>`;
    }
    $('#cards').innerHTML = `
      <div class="card main"><div class="k">${f.name}（${last.label}${mode === 'day' ? '' : ' 平均'}）</div><div class="v">${fmt(last.value, metric)}${u}</div>${diff}</div>
      <div class="card"><div class="k">最高</div><div class="v">${fmt(Math.max(...vals), metric)}</div></div>
      <div class="card"><div class="k">最低</div><div class="v">${fmt(Math.min(...vals), metric)}</div></div>
      <div class="card"><div class="k">平均</div><div class="v">${fmt(avg(vals), metric)}</div></div>`;
  }

  // グラフ
  const ds = [{ label: f.name, data: vals, borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'),
    tension: 0.25, pointRadius: s.length > 40 ? 0 : 4, pointHoverRadius: 6, borderWidth: 2.5, fill: false }];
  const legend = [];
  if (goals[metric] != null) {
    ds.push({ label: '目標', data: s.map(() => goals[metric]), borderColor: cssVar('--up'), borderDash: [6, 5], pointRadius: 0, borderWidth: 1.5 });
    legend.push(`赤の点線＝目標 ${goals[metric]}${f.unit}`);
  }
  const lastRec = [...records].reverse().find(r => r.ranges?.[metric]);
  if (lastRec) {
    const [lo, hi] = lastRec.ranges[metric];
    ds.push({ label: '標準下限', data: s.map(() => lo), borderColor: cssVar('--sub'), borderDash: [2, 4], pointRadius: 0, borderWidth: 1 });
    ds.push({ label: '標準上限', data: s.map(() => hi), borderColor: cssVar('--sub'), borderDash: [2, 4], pointRadius: 0, borderWidth: 1 });
    legend.push(`灰色の点線＝標準範囲 ${lo}〜${hi}${f.unit}（用紙の値）`);
  }
  $('#legend').textContent = legend.join(' ／ ');
  if (chart) chart.destroy();
  chart = new Chart($('#chart'), {
    type: 'line',
    data: { labels: s.map(p => p.label), datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${Number(c.parsed.y).toFixed(f.dec)}${f.unit}` } } },
      scales: {
        x: {
          ticks: {
            color: cssVar('--sub'), maxTicksLimit: 4, maxRotation: 0, font: { size: 11 },
            callback(v) { const l = this.getLabelForValue(v); return mode === 'year' ? l : l.slice(2).replace(/-/g, '/'); },
          },
          grid: { display: false },
        },
        y: { ticks: { color: cssVar('--sub') }, grid: { color: cssVar('--line') }, grace: '8%' },
      },
    },
  });

  // 数字の表（新しい順）
  const rows = [...s].reverse().map((p, i, a) => {
    const nxt = a[i + 1];
    let d = '';
    if (nxt) { const x = p.value - nxt.value; d = `<span class="${x > 0 ? 'up' : x < 0 ? 'down' : ''}">${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(f.dec)}</span>`; }
    return `<tr><td>${p.label}${p.n > 1 && mode !== 'day' ? `<small>（${p.n}回）</small>` : ''}</td><td>${fmt(p.value, metric)}${f.unit}</td><td>${d}</td></tr>`;
  }).join('');
  $('#trendTable').innerHTML = `<tr><th>${mode === 'day' ? '日付' : mode === 'month' ? '月' : '年'}</th><th>${f.name}${mode === 'day' ? '' : '（平均）'}</th><th>前回比</th></tr>${rows}`;
}

// ---------- 履歴 ----------
function renderList() {
  $('#listEmpty').hidden = records.length > 0;
  $('#recList').innerHTML = [...records].reverse().map(r => {
    const v = r.values;
    const sum = ['weight', 'pbf', 'lean', 'bmi'].filter(k => v[k] != null).map(k => `${META[k].name} ${fmt(v[k], k)}${META[k].unit}`).join(' ／ ');
    return `<li><div class="t">${r.at.replace('T', ' ')}</div><div class="s">${sum || '（主要項目なし）'}</div>${r.memo ? `<div class="s">📝 ${esc(r.memo)}</div>` : ''}
      <div class="acts"><button data-edit="${r.at}">編集</button><button class="del" data-del="${r.at}">削除</button></div></li>`;
  }).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('#recList').onclick = e => {
  if (e.target.dataset.edit) { const r = records.find(x => x.at === e.target.dataset.edit); openForm(r, null, true); showTab('add'); }
  if (e.target.dataset.del && confirm(e.target.dataset.del.replace('T', ' ') + ' の記録を削除する？')) {
    records = records.filter(x => x.at !== e.target.dataset.del); save(KEY_REC, records); renderList();
  }
};

// ---------- 入力フォーム ----------
let editingAt = null;
function fieldInput(f, id) {
  return `<label class="fld">${f.name}（${f.unit || '−'}）<input type="number" step="any" inputmode="decimal" id="${id}${f.key}" data-key="${f.key}"><span class="note"></span></label>`;
}
$('#fieldGrid').innerHTML = FIELDS.map(f => fieldInput(f, 'f_')).join('');
$('#segGrid').innerHTML = SEGMENTS.map(f => fieldInput(f, 'f_')).join('');

function openForm(rec, flags = {}, editing = false) {
  $('#form').hidden = false;
  editingAt = editing ? rec.at : null;
  $('#formTitle').textContent = editing ? '記録を編集' : '読み取り結果の確認';
  $('#f_at').value = rec.at || '';
  $('#f_memo').value = rec.memo || '';
  document.querySelectorAll('#form input[data-key]').forEach(inp => {
    const k = inp.dataset.key, v = rec.values?.[k];
    inp.value = v ?? '';
    const flag = flags?.[k];
    const info = typeof flag === 'string' && flag.startsWith('※');   // 計算で確かめた値の注記（黄色にしない）
    inp.classList.toggle('flag', (!!flag && !info) || (!editing && flags && v == null && META[k] && FIELDS.includes(META[k])));
    const note = inp.parentElement.querySelector('.note');
    note.textContent = typeof flag === 'string' ? flag : '';
    note.classList.toggle('info', info);
  });
  $('#form')._ranges = rec.ranges || {};
  $('#segDetails').open = SEGMENTS.some(s => rec.values?.[s.key] != null);
  $('#formHint').textContent = flags ? '黄色の欄は読み取れなかった、または自信がない項目です。用紙を見ながら確認・修正してください。' : '';
  $('#form').scrollIntoView({ behavior: 'smooth' });
}
$('#manualBtn').onclick = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  openForm({ at: d.toISOString().slice(0, 16), values: {} }, null, false);
};
$('#cancelBtn').onclick = () => { $('#form').hidden = true; };
$('#form').onsubmit = e => {
  e.preventDefault();
  const at = $('#f_at').value;
  if (!at) return;
  const values = {};
  document.querySelectorAll('#form input[data-key]').forEach(inp => {
    if (inp.value !== '') values[inp.dataset.key] = Number(inp.value);
  });
  if (!Object.keys(values).length) { alert('数値が1つも入っていません。'); return; }
  if (at !== editingAt && records.some(r => r.at === at) && !confirm('同じ日時の記録があります。上書きする？')) return;
  records = records.filter(r => r.at !== at && r.at !== editingAt);
  records.push({ at, values, ranges: $('#form')._ranges, memo: $('#f_memo').value.trim() });
  records.sort((a, b) => a.at.localeCompare(b.at));
  save(KEY_REC, records);
  $('#form').hidden = true; $('#progress').hidden = true;
  showTab('trend');
};

// ---------- 設定 ----------
$('#goalGrid').innerHTML = FIELDS.filter(f => f.main).map(f => fieldInput(f, 'g_')).join('');
document.querySelectorAll('#goalGrid input').forEach(i => { i.value = goals[i.dataset.key] ?? ''; });
$('#heightIn').value = goals.height ?? '';
$('#goalSave').onclick = () => {
  goals = {};
  if ($('#heightIn').value !== '') goals.height = Number($('#heightIn').value);
  document.querySelectorAll('#goalGrid input').forEach(i => { if (i.value !== '') goals[i.dataset.key] = Number(i.value); });
  save(KEY_GOAL, goals); alert('目標を保存しました。');
};
$('#backupBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'taisosei', records, goals }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `taisosei-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  $('#backupMsg').textContent = 'バックアップを保存しました。';
};
$('#restoreFile').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (d.app !== 'taisosei' || !Array.isArray(d.records)) throw 0;
    if (!confirm(`${d.records.length}件の記録で、今のデータを置き換える？`)) return;
    records = d.records.sort((a, b) => a.at.localeCompare(b.at)); goals = d.goals || {};
    save(KEY_REC, records); save(KEY_GOAL, goals);
    $('#heightIn').value = goals.height ?? '';
    document.querySelectorAll('#goalGrid input').forEach(i => { i.value = goals[i.dataset.key] ?? ''; });
    $('#backupMsg').textContent = '復元しました。';
  } catch { $('#backupMsg').textContent = '復元できませんでした。このアプリのバックアップファイルを選んでください。'; }
  e.target.value = '';
};
$('#wipeBtn').onclick = () => {
  if (confirm('すべての記録を削除する？元に戻せません。') && confirm('本当に削除する？')) {
    records = []; save(KEY_REC, records); showTab('trend');
  }
};

// ---------- 写真の読み取り（読み取りの本体は reader.js） ----------
const setProgress = (p, t) => { $('#progress').hidden = false; $('#barFill').style.width = Math.round(p * 100) + '%'; $('#progressText').textContent = t; };

$('#photo').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  $('#form').hidden = true;
  try {
    const res = await readSheet(file, { height: goals.height, onProgress: setProgress });
    setProgress(1, '読み取り完了');
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    const flags = { ...res.flags };
    const rec = { at: res.at || d.toISOString().slice(0, 16), values: Object.fromEntries(Object.entries(res.values).filter(([, v]) => v != null)), ranges: {} };
    openForm(rec, flags, false);
    if (!res.at) $('#formHint').textContent = '測定日時が読み取れなかったので、今の日時を入れています。日付を直してください。' + $('#formHint').textContent;
    else if (flags._at) $('#formHint').textContent = '測定日時の年を読み違えたようなので直しました。日付を確認してください。' + $('#formHint').textContent;
  } catch (err) {
    console.error(err);
    setProgress(0, '読み取りに失敗しました。手入力をお使いください。');
  }
  e.target.value = '';
};

// ---------- 起動 ----------
buildMetricUI();
renderTrend();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
