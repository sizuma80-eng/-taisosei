'use strict';
// InBody用紙の写真から数値を読み取る。
// 流れ: 写真を白黒にする → 数字のかたまりを1つずつ見つける → 1つずつ読む → 位置と並び順で項目に割り当てる
//       → 数値どうしの関係（水分+タンパク質+ミネラル+体脂肪=体重 など）で読み間違いを見抜く
// FIELDS / META は app.js で定義している。

// ---------- 画像の準備 ----------
async function sheetCanvas(file, W = 2000) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, W / bmp.width);
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, w, h);

  // 照明ムラ補正: 紙の明るさ（ぼかした画像）で割って、影や暗い隅を平らにする
  const k = 8, sw = Math.ceil(w / k), sh = Math.ceil(h / k);
  const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
  const sx = sm.getContext('2d'); sx.filter = 'grayscale(1)'; sx.drawImage(c, 0, 0, sw, sh);
  const bl = document.createElement('canvas'); bl.width = sw; bl.height = sh;
  const bx = bl.getContext('2d'); bx.filter = 'blur(7px)'; bx.drawImage(sm, 0, 0);
  const bg = document.createElement('canvas'); bg.width = w; bg.height = h;
  const gx = bg.getContext('2d', { willReadFrequently: true }); gx.imageSmoothingQuality = 'high'; gx.drawImage(bl, 0, 0, w, h);
  const a = x.getImageData(0, 0, w, h), b = gx.getImageData(0, 0, w, h);
  const N = w * h, gray = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const g = 0.299 * a.data[i * 4] + 0.587 * a.data[i * 4 + 1] + 0.114 * a.data[i * 4 + 2];
    gray[i] = Math.max(0, Math.min(255, (g / (b.data[i * 4] + 1) - 0.15) / 0.85 * 255));
  }

  // 局所しきい値で白黒にする（周りより暗い所＝文字）
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let xx = 0; xx < w; xx++) { row += gray[y * w + xx]; I[(y + 1) * (w + 1) + xx + 1] = I[y * (w + 1) + xx + 1] + row; } }
  const R = 15, bin = new Uint8Array(N);   // 1=黒
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    for (let xx = 0; xx < w; xx++) {
      const x0 = Math.max(0, xx - R), x1 = Math.min(w, xx + R + 1);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      bin[y * w + xx] = gray[y * w + xx] < m * 0.8 ? 1 : 0;
    }
  }
  // 表の細い横線を消す（数字と線がくっつかないように）
  const mark = new Uint8Array(N);
  for (let y = 0; y < h; y++) { let st = -1; for (let xx = 0; xx <= w; xx++) { const on = xx < w && bin[y * w + xx]; if (on && st < 0) st = xx; if (!on && st >= 0) { if (xx - st >= 80) for (let q = st; q < xx; q++) mark[y * w + q] = 1; st = -1; } } }
  for (let xx = 0; xx < w; xx++) { let st = -1; for (let y = 0; y <= h; y++) { const on = y < h && mark[y * w + xx]; if (on && st < 0) st = y; if (!on && st >= 0) { if (y - st <= 7) for (let q = st; q < y; q++) bin[q * w + xx] = 0; st = -1; } } }

  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ox = out.getContext('2d'), od = ox.createImageData(w, h);
  for (let i = 0; i < N; i++) { const v = bin[i] ? 0 : 255; od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = v; od.data[i * 4 + 3] = 255; }
  ox.putImageData(od, 0, 0);
  return { canvas: out, gray, bin, w, h };
}

// ---------- かたまり（ブロブ）の検出 ----------
function findBlobs(mask, w, h, G) {
  const sw = w >> 1, sh = h >> 1, m = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = 2 * y * w + 2 * x;
    if (mask[i] || mask[i + 1] || mask[i + w] || mask[i + w + 1]) m[y * sw + x] = 1;
  }
  for (let y = 0; y < sh; y++) { let last = -999; for (let x = 0; x < sw; x++) { if (m[y * sw + x]) { if (x - last > 1 && x - last <= G) for (let q = last + 1; q < x; q++) m[y * sw + q] = 1; last = x; } } }
  const lab = new Int32Array(sw * sh), boxes = [], stack = new Int32Array(sw * sh);
  let id = 0;
  for (let s = 0; s < sw * sh; s++) {
    if (!m[s] || lab[s]) continue;
    id++; let sp = 0; stack[sp++] = s; lab[s] = id; let x0 = sw, y0 = sh, x1 = 0, y1 = 0, n = 0;
    while (sp) {
      const p = stack[--sp], px = p % sw, py = (p / sw) | 0; n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (px > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
      if (px < sw - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
      if (py > 0 && m[p - sw] && !lab[p - sw]) { lab[p - sw] = id; stack[sp++] = p - sw; }
      if (py < sh - 1 && m[p + sw] && !lab[p + sw]) { lab[p + sw] = id; stack[sp++] = p + sw; }
    }
    boxes.push({ x0: x0 * 2, y0: y0 * 2, x1: x1 * 2 + 2, y1: y1 * 2 + 2, n });
  }
  return boxes;
}

// 棒グラフ（太い横帯）を探す。灰色の部分も含めるため、白黒にする前の明るさで見る
function findBars(gray, w, h) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let st = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && gray[y * w + x] < 175;
      if (on && st < 0) st = x;
      if (!on && st >= 0) { if (x - st >= 40) for (let q = st; q < x; q++) mask[y * w + q] = 1; st = -1; }
    }
  }
  return findBlobs(mask, w, h, 6)
    .filter(b => b.x0 > 0.1 * w && b.x0 < 0.3 * w && b.x1 - b.x0 > 0.07 * w && b.x1 - b.x0 < 0.3 * w && b.y1 - b.y0 >= 8 && b.y1 - b.y0 <= 40 && b.y1 < 0.75 * h)
    .sort((p, q) => p.y0 - q.y0);
}
// 検出した横帯のうち、棒グラフの並び（3本・間隔・2本）に合う5本を選ぶ
function pickFiveBars(all) {
  for (let i = 0; i + 5 <= all.length; i++) {
    const y = all.slice(i, i + 5).map(b => (b.y0 + b.y1) / 2);
    const d = [y[1] - y[0], y[2] - y[1], y[3] - y[2], y[4] - y[3]];
    if (d[0] >= 40 && d[0] <= 130 && d[1] >= 40 && d[1] <= 130 && d[2] >= 130 && d[2] <= 520 && d[3] >= 40 && d[3] <= 130) return all.slice(i, i + 5);
  }
  return [];
}

// ---------- 1つずつ読む ----------
async function readCrops(canvas, rects, psms, onStep, opts = {}) {
  const worker = await Tesseract.createWorker('eng', 1, { workerPath: 'lib/worker.min.js', corePath: 'lib/', langPath: 'lib/lang/', gzip: true });
  const res = rects.map(() => []);
  try {
    for (const psm of psms) {
      await worker.setParameters({ tessedit_char_whitelist: '0123456789.~()-:/', tessedit_pageseg_mode: String(psm) });
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i], m = opts.margin ?? 6;
        const x0 = Math.max(0, r.x0 - m), y0 = Math.max(0, r.y0 - m), x1 = Math.min(canvas.width, r.x1 + m), y1 = Math.min(canvas.height, r.y1 + m);
        const S = opts.scale || Math.max(1, Math.min(3, 56 / (y1 - y0)));
        const t = document.createElement('canvas'); t.width = Math.max(8, Math.round((x1 - x0) * S)); t.height = Math.max(8, Math.round((y1 - y0) * S));
        const g = t.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, t.width, t.height);
        // 文字を少し太らせて読む（細い線が切れて「4」が「1」に見えるのを防ぐ）
        g.globalCompositeOperation = 'darken';
        for (let dx = 0; dx <= (opts.dilate || 0); dx++) for (let dy = 0; dy <= (opts.dilate || 0); dy++) g.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, dx, dy, t.width - (opts.dilate || 0), t.height - (opts.dilate || 0));
        res[i].push((await worker.recognize(t)).data.text.trim());
      }
      if (onStep) onStep();
    }
  } finally { await worker.terminate(); }
  return res;
}

// 読み取った文字列 → 候補の数値（何回の読み取りで出たか=票数つき）
function candidatesOf(texts) {
  const votes = new Map();
  for (const t of texts) {
    for (const piece of t.split(/\s+/)) {
      for (const m of piece.matchAll(/\d+(?:\.\d+)?/g)) {
        votes.set(m[0], (votes.get(m[0]) || 0) + 1);
        // 単位（kg など）が数字として混ざって桁が増えることがあるので、小数を短くした読み方も候補にする
        const dot = m[0].indexOf('.');
        if (dot >= 0) for (let d = 1; d < m[0].length - dot - 1; d++) { const s2 = m[0].slice(0, dot + 1 + d); votes.set(s2, (votes.get(s2) || 0) + 1); }
      }
    }
  }
  return [...votes].map(([s, n]) => ({ s, v: parseFloat(s), dec: (s.split('.')[1] || '').length, n })).sort((a, b) => b.n - a.n);
}

// 並び順を保ったまま、項目とトークンを最もうまく対応づける
function alignOrdered(fields, toks, fit) {
  const F = fields.length, T = toks.length;
  const dp = Array.from({ length: F + 1 }, () => new Float64Array(T + 1));
  for (let i = 1; i <= F; i++) for (let j = 1; j <= T; j++) {
    let best = Math.max(dp[i - 1][j], dp[i][j - 1]);
    const s = fit(fields[i - 1], toks[j - 1]);
    if (s != null) best = Math.max(best, dp[i - 1][j - 1] + 10 + s);
    dp[i][j] = best;
  }
  const out = new Map(); let i = F, j = T;
  while (i > 0 && j > 0) {
    const s = fit(fields[i - 1], toks[j - 1]);
    if (s != null && dp[i][j] === dp[i - 1][j - 1] + 10 + s) { out.set(fields[i - 1], toks[j - 1]); i--; j--; }
    else if (dp[i][j] === dp[i - 1][j]) i--;
    else j--;
  }
  return out;
}

const segDec = k => (k === 'seg_lean_tr' || k.startsWith('seg_fat')) ? 1 : 2;   // 部位別の小数の桁（四肢の筋肉量は2桁、他は1桁）
const segMax = k => k.endsWith('_tr') ? 45 : (k.endsWith('_la') || k.endsWith('_ra')) ? 10 : 20;   // 部位ごとのあり得る上限（kg）
const round1 = v => Math.round(v * 10) / 10;
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

// ---------- 全体 ----------
async function readSheet(file, opts = {}) {
  const say = opts.onProgress || (() => {});
  say(0.03, '写真を準備しています…');
  const { canvas, gray, bin, w, h } = await sheetCanvas(file);

  say(0.12, '数字の場所を探しています…');
  const allBlobs = findBlobs(bin, w, h, 12);
  const blobs = allBlobs
    .filter(b => { const bh = b.y1 - b.y0, bw = b.x1 - b.x0; return bh >= 16 && bh <= 70 && bw >= 14 && bw <= 400 && b.n >= 25; });
  const bars = pickFiveBars(findBars(gray, w, h));

  // 数字のかたまりを3通りの読み方で読む（読み方によって間違い方が違うので、多数決にする）
  say(0.2, '数字を読み取っています…');
  let step = 0;
  const texts = await readCrops(canvas, blobs, [8, 7, 13], () => { step++; say(0.2 + 0.55 * step / 3, '数字を読み取っています…'); });
  const toks = blobs.map((b, i) => {
    const raw = texts[i].join(' ');
    const range = raw.match(/\d{1,3}\.\d{1,2}\s*~\s*\d{1,3}\.\d{1,2}/);   // 「(39.2~47.8)」の形だけを範囲とみなす
    return { ...b, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, raw, texts: texts[i], range: !!range, cands: candidatesOf(texts[i]) };
  }).filter(t => t.cands.length || t.range);

  const skeletalRow = toks.filter(t => t.range && t.cx > 0.85 * w && t.cy > 0.5 * h).sort((p, q) => p.cy - q.cy)[0];
  const inVflWindow = t => skeletalRow && t.cx > 0.66 * w && t.cx < 0.82 * w && t.cy > skeletalRow.cy - 0.08 * h && t.cy < skeletalRow.cy - 0.02 * h;
  // 値になりそうなかたまりは、切り出しの余白や太さを変えて何回も読む（読み間違いを減らす）
  say(0.7, '数字をもう一度確かめています…');
  const want = toks.filter(t => !t.range && t.cy > 0.1 * h && t.cands.some(c => (c.dec >= 1 && c.dec <= 2 && c.v >= 0.3 && c.v <= 250) || (c.dec === 0 && c.v >= 600 && c.v <= 4000)) || inVflWindow(t) || (t.cx > 0.6 * w && t.cy < 0.4 * h && /100/.test(t.raw)));
  for (const o of [{ margin: 2 }, { margin: 11 }, { margin: 6, dilate: 1 }, { margin: 6, dilate: 2 }]) {
    const more = await readCrops(canvas, want, [8, 7, 13], null, o);
    want.forEach((t, i) => { t.texts = t.texts.concat(more[i]); t.raw += ' ' + more[i].join(' '); });
  }
  want.forEach(t => { t.cands = candidatesOf(t.texts); });

  const out = { values: {}, flags: {}, at: null, debug: { toks, bars } };
  const flag = (k, msg) => { out.flags[k] = msg; };
  const fitDec = (f, c) => c.dec === f.dec && c.v >= f.min && c.v <= f.max;

  // --- 測定日時（ヘッダーの行を1本の文字列として読む）
  say(0.78, '測定日時を読み取っています…');
  const headBlobs = allBlobs.filter(b => b.y1 < 0.3 * h && b.x0 > 0.3 * w && b.y1 - b.y0 >= 20 && b.y1 - b.y0 <= 120 && b.x1 - b.x0 >= 150 && b.x1 - b.x0 <= 450 && b.n >= 300);
  const headTexts = await readCrops(canvas, headBlobs.map(b => ({ x0: b.x0 - 10, x1: b.x1 + 14, y0: b.y0 - 4, y1: b.y1 + 4 })), [6], null, { scale: 2 });
  let height = null;
  for (let i = 0; i < headBlobs.length; i++) {
    const m = headTexts[i][0].match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2}):\s*(\d{2})/);
    if (!m) continue;
    const p = n => String(n).padStart(2, '0');
    let at = `20${m[1].slice(-2)}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}`;   // 年の頭の1桁は読み間違えやすいので下2桁だけ使う
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    if (at > now.toISOString().slice(0, 16)) { at = now.getFullYear() + at.slice(4); flag('_at', '年の読み取りを直しました'); }
    out.at = at; break;
  }
  // 身長（ヘッダーの「178cm」。縦線とくっついているので、ブロック読みで読む）
  const hBlobs = allBlobs.filter(b => b.y1 < 0.3 * h && b.x0 > 0.1 * w && b.x0 < 0.35 * w && b.y1 - b.y0 >= 20 && b.y1 - b.y0 <= 130 && b.x1 - b.x0 >= 60 && b.x1 - b.x0 <= 300 && b.n >= 150);
  const hTexts = await readCrops(canvas, hBlobs.map(b => ({ x0: b.x0 + 6, x1: b.x1 + 8, y0: b.y0 - 2, y1: b.y1 + 2 })), [6], null, { scale: 2 });
  for (const t of hTexts) { const m = t[0].match(/(?:^|\D)(1[2-9]\d|2[01]\d)(?:\D|$)/); if (m) { height = +m[1]; break; } }
  if (height == null) height = opts.height || null;

  // --- 左上の表（体水分量・タンパク質量・ミネラル量・体脂肪量・体重）
  say(0.82, '項目を割り当てています…');
  const tableBottom = bars.length ? bars[0].y0 - 0.04 * h : 0.34 * h;
  const left = toks.filter(t => !t.range && t.cx > 0.36 * w && t.cx < 0.58 * w && t.cy > 0.1 * h && t.cy < tableBottom).sort((p, q) => p.cy - q.cy);
  const leftKeys = ['water', 'protein', 'mineral', 'fat', 'weight'];
  const pool = {};   // 項目ごとの候補（あとで数値どうしの関係で選び直す）
  const bestFit = (k, t) => t.cands.filter(c => fitDec(META[k], c));
  const lt = alignOrdered(leftKeys, left, (k, t) => { const c = bestFit(k, t)[0]; return c ? c.n : null; });
  for (const [k, t] of lt) pool[k] = bestFit(k, t);

  // --- 棒グラフの右の数値（体重・筋肉量・体脂肪量 / BMI・体脂肪率）
  const barKeys = [['weight', 'lean', 'fat'], ['bmi', 'pbf']];
  if (bars.length === 5) {
    const rows = [...bars.slice(0, 3), ...bars.slice(3)];
    const keys = ['weight', 'lean', 'fat', 'bmi', 'pbf'];
    const rects = [];
    for (const b of rows) for (const off of [6, 16, 26]) for (const wd of [110, 135]) rects.push({ x0: b.x1 + off, x1: b.x1 + off + wd, y0: b.y0 - 18, y1: b.y1 + 24 });
    say(0.86, '棒グラフの数値を読み取っています…');
    const rt = await readCrops(canvas, rects, [7, 8, 13]);
    rows.forEach((b, i) => {
      const all = rt.slice(i * 6, i * 6 + 6).flat();
      const c = candidatesOf(all).filter(c2 => fitDec(META[keys[i]], c2));
      if (c.length) pool['bar_' + keys[i]] = c;
    });
  }

  // --- 右の列（骨格筋量〜骨格筋指数）
  const rightKeys = ['skeletal', 'ffm', 'bmr', 'waist', 'ffmi', 'fmi', 'smmwt', 'smi'];
  const rightTop = skeletalRow ? skeletalRow.cy - 0.03 * h : 0.6 * h;
  const right = toks.filter(t => !t.range && t.cx > 0.68 * w && t.cx < 0.93 * w && t.cy > rightTop && t.cy < 0.9 * h).sort((p, q) => p.cy - q.cy);
  const rt2 = alignOrdered(rightKeys, right, (k, t) => { const c = bestFit(k, t)[0]; return c ? c.n : null; });
  for (const [k, t] of rt2) pool[k] = bestFit(k, t);

  // 内臓脂肪レベル: 骨格筋量の少し上にある小さな整数のうち、いちばん左のもの
  const skY = skeletalRow ? skeletalRow.cy : rightTop + 0.03 * h;
  const vfl = toks.filter(t => !t.range && t.cx > 0.66 * w && t.cx < 0.82 * w && t.cy > skY - 0.08 * h && t.cy < skY - 0.02 * h && t.cands.some(c => c.dec === 0 && c.v >= 1 && c.v <= 30))
    .sort((p, q) => p.cx - q.cx)[0];
  if (vfl) pool.vfl = vfl.cands.filter(c => c.dec === 0 && c.v >= 1 && c.v <= 30);

  // InBody点数（「83/100点」）
  const waterTok = lt.get('water');
  const scLo = waterTok ? waterTok.cy - 0.04 * h : 0.1 * h, scHi = waterTok ? waterTok.cy + 0.06 * h : 0.25 * h;
  const sc = toks.filter(t => t.cx > 0.6 * w && t.cy > scLo && t.cy < scHi && /^\D*\d{2,3}/.test(t.raw))
    .map(t => t.texts.map(s => s.match(/^\D*(\d{2,3}?)\/?100\d?\D*$/) || s.match(/^\D*(\d{2,3})\D*$/)).filter(Boolean).map(m => +m[1]).filter(v => v >= 1 && v <= 120))
    .flat();
  if (sc.length) { const cnt = new Map(); sc.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1)); pool.score = [...cnt].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ v, n, s: String(v), dec: 0 })); }

  // --- 部位別（左の図=筋肉量、右の図=体脂肪量）。上段の2つ・中央・下段の2つの順
  const segTop = (bars.length ? bars[4].y1 : 0.5 * h) + 0.03 * h;
  // 数値のあとに「kg」が続くので幅がある。「標準」などの文字の読み違いを除く
  const segTok = toks.filter(t => !t.range && t.cy > segTop && t.cy < 0.9 * h && t.cx < 0.66 * w && t.x1 - t.x0 >= 60 && t.cands.some(c => c.dec >= 1 && c.dec <= 2 && c.v > 0 && c.v < 60 && c.n >= 2));
  // 「kg」が数字に混ざらないよう、左の数字の部分だけを切り出して読み直す
  for (const frac of [0.66, 0.72, 0.78]) {
    const more = await readCrops(canvas, segTok.map(t => ({ x0: t.x0, x1: t.x0 + (t.x1 - t.x0) * frac, y0: t.y0, y1: t.y1 })), [8, 7, 13]);
    segTok.forEach((t, i) => { t.texts = t.texts.concat(more[i]); });
  }
  segTok.forEach(t => { t.cands = candidatesOf(t.texts); });
  const strength = t => Math.max(...t.cands.filter(c => c.dec >= 1 && c.dec <= 2).map(c => c.n), 0);
  const segGroup = (xmin, xmax, keys) => {
    const g = segTok.filter(t => t.cx >= xmin && t.cx < xmax).sort((p, q) => p.cy - q.cy);
    if (g.length < 5) return;
    // 段（上2・中1・下2）に分ける。余分なかたまりは、読み取りの票が弱いものから捨てる
    let rows = []; for (const t of g) { const r = rows.find(r2 => Math.abs(r2.cy - t.cy) < 55); if (r) { r.t.push(t); r.cy = (r.cy * (r.t.length - 1) + t.cy) / r.t.length; } else rows.push({ cy: t.cy, t: [t] }); }
    if (rows.length < 3) return;
    rows = rows.sort((p, q) => Math.max(...q.t.map(strength)) - Math.max(...p.t.map(strength))).slice(0, 3).sort((p, q) => p.cy - q.cy);
    const need = [2, 1, 2];
    if (rows.some((r, i) => r.t.length < need[i])) return;
    const order = rows.flatMap((r, i) => r.t.sort((p, q) => strength(q) - strength(p)).slice(0, need[i]).sort((p, q) => p.cx - q.cx));
    order.forEach((t, i) => { const d = segDec(keys[i]); const mx = segMax(keys[i]); pool[keys[i]] = t.cands.filter(c => c.dec === d && c.v > 0 && c.v < mx); });
  };
  segGroup(0, 0.32 * w, ['seg_lean_la', 'seg_lean_ra', 'seg_lean_tr', 'seg_lean_ll', 'seg_lean_rl']);
  segGroup(0.32 * w, 0.66 * w, ['seg_fat_la', 'seg_fat_ra', 'seg_fat_tr', 'seg_fat_ll', 'seg_fat_rl']);

  // ---------- 数値どうしの関係で選び直す ----------
  const top = k => (pool[k] && pool[k][0]) ? pool[k][0].v : null;
  const set = (k, v, msg) => { out.values[k] = v; if (msg) flag(k, msg); };

  // 1) 水分+タンパク質+ミネラル+体脂肪 = 体重
  const base = ['water', 'protein', 'mineral', 'fat', 'weight'];
  if (base.every(k => pool[k] && pool[k].length)) {
    const lists = base.map(k => pool[k].slice(0, 3));
    let best = null;
    const rec = (i, cur, votes) => {
      if (i === 5) { const sum = cur[0] + cur[1] + cur[2] + cur[3]; if (Math.abs(sum - cur[4]) <= 0.16 && (!best || votes > best.votes)) best = { cur: [...cur], votes }; return; }
      for (const c of lists[i]) { cur[i] = c.v; rec(i + 1, cur, votes + c.n); }
    };
    rec(0, [], 0);
    if (best) base.forEach((k, i) => set(k, best.cur[i]));
    else {
      // 1つだけ読み間違えている場合は、残りの合計から正しい値を求める（票が最も少ない項目を直す）
      const tops = base.map(k => top(k));
      let fix = null;
      base.forEach((k, i) => {
        const others = tops.reduce((a, v, j) => j === i ? a : a + (j === 4 ? 0 : v), 0);
        const implied = i === 4 ? round1(tops[0] + tops[1] + tops[2] + tops[3]) : round1(tops[4] - others);
        const f = META[k];
        if (implied < f.min || implied > f.max) return;
        const strength = pool[k][0].n;
        if (!fix || strength < fix.strength) fix = { i, implied: f.dec === 2 ? Math.round((i === 4 ? 0 : 0) + implied * 100) / 100 : implied, strength };
      });
      base.forEach((k, i) => set(k, tops[i]));
      if (fix) {
        const k = base[fix.i];
        const exact = fix.i === 4 ? tops[0] + tops[1] + tops[2] + tops[3] : tops[4] - tops.reduce((a, v, j) => (j === fix.i || j === 4) ? a : a + v, 0);
        set(k, META[k].dec === 2 ? Math.round(exact * 100) / 100 : round1(exact), '他の項目の合計から計算しました。用紙と見比べてください');
      } else base.forEach(k => flag(k, '合計が合わないので用紙と見比べてください'));
    }
  } else base.forEach(k => { if (top(k) != null) set(k, top(k), '一部の項目が読めなかったので確認してください'); });

  // 棒グラフの右の数値で、体重・体脂肪量の確認と体重の補完
  const barV = k => pool['bar_' + k] ? pool['bar_' + k][0].v : null;
  if (out.values.weight == null && barV('weight') != null) set('weight', barV('weight'), '棒グラフの横の数字から読み取りました');
  if (out.values.fat == null && barV('fat') != null) set('fat', barV('fat'), '棒グラフの横の数字から読み取りました');

  const V = out.values, hh = height ? height / 100 : null;

  // 2) 除脂肪量 = 水分+タンパク質+ミネラル
  if (V.water != null && V.protein != null && V.mineral != null) {
    const exp = round1(V.water + V.protein + V.mineral);
    const c = (pool.ffm || []).find(c2 => near(c2.v, exp, 0.16));
    if (c) set('ffm', c.v); else set('ffm', exp, '水分+タンパク質+ミネラルで計算しました');
  } else if (top('ffm') != null) set('ffm', top('ffm'), '一部の項目が読めなかったので確認してください');

  // 3) 基礎代謝量 ≒ 370 + 21.6 × 除脂肪量
  if (V.ffm != null) {
    const exp = Math.round(370 + 21.6 * V.ffm);
    const c = (pool.bmr || []).find(c2 => near(c2.v, exp, 4));
    if (c) set('bmr', c.v); else set('bmr', exp, '除脂肪量から計算しました');
  } else if (top('bmr') != null) set('bmr', top('bmr'));

  // 4) 体脂肪率・BMI・指数類（計算で確かめられる。計算で求めたときは「※」の注記だけ付ける）
  const pick = (k, exp, tol, msg) => {
    if (exp == null || isNaN(exp)) { if (top(k) != null) set(k, top(k), '確認してください'); return; }
    const c = [...(pool[k] || []), ...(pool['bar_' + k] || [])].find(c2 => near(c2.v, exp, tol));
    if (c) set(k, c.v); else set(k, round1(exp), '※' + msg);
  };
  if (V.fat != null && V.weight) pick('pbf', V.fat / V.weight * 100, 0.12, '体脂肪量÷体重で計算しました');
  else if (top('pbf') != null) set('pbf', top('pbf'), '確認してください');
  if (hh && V.weight) pick('bmi', V.weight / hh ** 2, 0.12, '身長と体重から計算しました');
  else if (top('bmi') != null) set('bmi', top('bmi'), '確認してください');
  if (hh && V.ffm != null) pick('ffmi', V.ffm / hh ** 2, 0.12, '除脂肪量と身長から計算しました');
  else if (top('ffmi') != null) set('ffmi', top('ffmi'), '確認してください');
  if (hh && V.fat != null) pick('fmi', V.fat / hh ** 2, 0.12, '体脂肪量と身長から計算しました');
  else if (top('fmi') != null) set('fmi', top('fmi'), '確認してください');

  // 5) 骨格筋量と骨格筋率（骨格筋率 = 骨格筋量 ÷ 体重）
  const sk = (pool.skeletal || []), sm = (pool.smmwt || []);
  if (V.weight) {
    let pair = null;
    for (const a2 of sk.slice(0, 3)) for (const b2 of sm.slice(0, 3)) if (near(a2.v / V.weight * 100, b2.v, 0.25) && (!pair || a2.n + b2.n > pair.n)) pair = { a: a2.v, b: b2.v, n: a2.n + b2.n };
    if (pair) { set('skeletal', pair.a); set('smmwt', pair.b); }
    else if (sk.length && sm.length) { set('skeletal', sk[0].v, '骨格筋率と合わないので確認してください'); set('smmwt', sm[0].v, '骨格筋量と合わないので確認してください'); }
    else if (sk.length) { set('skeletal', sk[0].v); set('smmwt', round1(sk[0].v / V.weight * 100), '※骨格筋量÷体重で計算しました'); }
    else if (sm.length) { set('smmwt', sm[0].v); set('skeletal', round1(sm[0].v * V.weight / 100), '骨格筋率×体重で計算しました。確認してください'); }
  } else { if (sk.length) set('skeletal', sk[0].v); if (sm.length) set('smmwt', sm[0].v); }

  // 6) 筋肉量（棒グラフの右の数値）。除脂肪量 − ミネラル×0.85 に近いものを選ぶ
  if (V.ffm != null && V.mineral != null) {
    const exp = V.ffm - 0.85 * V.mineral;
    const c = (pool.bar_lean || []).find(c2 => near(c2.v, exp, 0.4));
    if (c) set('lean', c.v); else set('lean', round1(exp), '棒グラフの数字が読めなかったので、除脂肪量とミネラル量から推定しました（誤差0.3kg程度）。確認してください');
  } else if (barV('lean') != null) set('lean', barV('lean'), '棒グラフの横の数字から読み取りました。確認してください');

  // 7) 部位別と骨格筋指数（SMI = 四肢の筋肉量の合計 ÷ 身長²）。四肢の4つの値は、SMIと合う組み合わせを選ぶ
  const limbKeys = ['seg_lean_la', 'seg_lean_ra', 'seg_lean_ll', 'seg_lean_rl'];
  let limbsOk = false;
  if (hh && limbKeys.every(k => pool[k] && pool[k].length)) {
    const lists = limbKeys.map(k => pool[k].slice(0, 3)), smiC = (pool.smi || []).slice(0, 3);
    let best = null;
    const rec = (i, cur, votes) => {
      if (i === 4) {
        const val = cur.reduce((x, y) => x + y, 0) / hh ** 2;
        for (const c of smiC) if (Math.abs(val - c.v) <= 0.055 && (!best || votes + c.n > best.votes)) best = { cur: [...cur], votes: votes + c.n, smi: c.v };
        return;
      }
      for (const c of lists[i]) { cur[i] = c.v; rec(i + 1, cur, votes + c.n); }
    };
    rec(0, [], 0);
    if (best) { limbKeys.forEach((k, i) => set(k, best.cur[i])); set('smi', best.smi); limbsOk = true; }
  }
  // 部位別の残り（上の組み合わせで決まらなかった分）は、いちばん票の多い読みを使う
  for (const k of Object.keys(META).filter(k2 => k2.startsWith('seg_'))) {
    if (out.values[k] == null && top(k) != null) set(k, top(k), k === 'seg_lean_tr' || k.startsWith('seg_fat') ? null : '位置から推定した値です。確認してください');
  }
  if (!limbsOk) {
    const limbs = limbKeys.map(k => V[k]);
    if (hh && limbs.every(v => v != null)) pick('smi', limbs.reduce((x, y) => x + y, 0) / hh ** 2, 0.08, '四肢の筋肉量と身長から計算しました');
    else if (top('smi') != null) set('smi', top('smi'), '確認してください');
    limbKeys.forEach(k => { if (V[k] != null) flag(k, '位置から推定した値です。確認してください'); });
  }
  // 体幹の筋肉量は、筋肉量との差（約5.0〜5.5kg）で、体脂肪側は体脂肪量との差（約1.2kg）で確かめる
  if (V.seg_lean_tr != null) {
    if (V.lean != null && limbsOk) {
      const sum5 = limbKeys.reduce((x, k) => x + V[k], 0) + V.seg_lean_tr;
      if (!(V.lean - sum5 >= 4.6 && V.lean - sum5 <= 5.9)) flag('seg_lean_tr', '筋肉量と合わないので確認してください');
    } else flag('seg_lean_tr', '位置から推定した値です。確認してください');
  }
  const fk = ['seg_fat_la', 'seg_fat_ra', 'seg_fat_tr', 'seg_fat_ll', 'seg_fat_rl'];
  if (fk.every(k => V[k] != null) && V.fat != null) {
    const gap = V.fat - fk.reduce((x, k) => x + V[k], 0);
    if (!(gap >= 0.6 && gap <= 1.8)) fk.forEach(k => flag(k, '体脂肪量と合わないので確認してください'));
  } else fk.forEach(k => { if (V[k] != null) flag(k, '位置から推定した値です。確認してください'); });

  const weak = k => { const p = pool[k]; return (p && p[0] && (p[0].n < 3 || (p[1] && p[1].n >= p[0].n * 0.6))) ? '読み取りに自信がありません。確認してください' : null; };
  if (top('waist') != null) set('waist', top('waist'), weak('waist'));
  if (top('vfl') != null) set('vfl', top('vfl'), weak('vfl'));
  if (top('score') != null) set('score', top('score'), weak('score'));
  out.height = height;
  out.debug.pool = pool;
  return out;
}
