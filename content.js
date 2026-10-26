/*
 * content.js - findings panel + "Prepare rejection" automation for translate.wordpress.org (es-CL)
 *
 * Flow:  Scan page -> review/tick rows -> "Prepare rejection":
 *   1. ticks the chosen rows' checkboxes (and unticks the others)
 *   2. picks "Reject" in the bulk-actions dropdown
 *   3. clicks Apply (optional) -> GlotPress opens the "Reject with Feedback" window
 *   4. ticks "Style Guide" and writes the comment
 * It STOPS there. The final "Request changes" button is always yours to press.
 */
(function () {
  'use strict';
  if (window.__gpFormalCheckLoaded) return;
  window.__gpFormalCheckLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const Engine = self.FormalityEngine;
  const Feedback = self.GPFC_Feedback;
  const BASE_WL = self.FORMALITY_WORDLIST;
  const t = self.GPFC_t;

  let S = self.GPFC_mergeSettings({});
  let items = [];                  // flagged rows
  let scannedRows = 0;
  const selected = new Set();      // row ids ticked in the panel
  let busy = false;
  let lastStatus = { key: 'scanFirst', kind: 'info', vars: null };
  let scanned = false;

  const L = (key, vars) => t(S.lang, key, vars);

  // ------------------------------------------------------------------
  // small DOM helper
  // ------------------------------------------------------------------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === false || v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  /** renders `text` with <mark> around the given non-overlapping ranges */
  function marked(text, ranges, cls) {
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const r of ranges.slice().sort((a, b) => a.start - b.start)) {
      if (r.start < pos) continue;
      if (r.start > pos) frag.append(text.slice(pos, r.start));
      frag.append(h('mark', { class: r.cls || cls, text: text.slice(r.start, r.end) }));
      pos = r.end;
    }
    if (pos < text.length) frag.append(text.slice(pos));
    return frag;
  }

  // ------------------------------------------------------------------
  // settings
  // ------------------------------------------------------------------
  async function loadSettings() {
    try {
      const r = await api.storage.local.get('settings');
      S = self.GPFC_mergeSettings(r.settings);
    } catch (e) { S = self.GPFC_mergeSettings({}); }
  }

  function currentWordlist() {
    const extra = (S.extraVerbs || '').split('\n').map((x) => x.trim().toLowerCase()).filter(Boolean);
    return Object.assign({}, BASE_WL, { formal_verbs: BASE_WL.formal_verbs.concat(extra) });
  }

  // ------------------------------------------------------------------
  // scanning
  // ------------------------------------------------------------------
  const statusOf = (tr) => {
    for (const c of tr.classList) if (c.startsWith('status-')) return c.slice(7);
    return '';
  };

  function clearPageMarks() {
    document.querySelectorAll('tr.preview[data-gpfc]').forEach((tr) => tr.removeAttribute('data-gpfc'));
  }

  function scan() {
    clearPageMarks();
    const wl = currentWordlist();
    const vset = Engine.verbsetN(wl);
    items = [];
    scannedRows = 0;
    document.querySelectorAll('table#translations tr.preview').forEach((tr, i) => {
      scannedRows++;
      const esEls = tr.querySelectorAll('td.translation .translation-text');
      const enEls = tr.querySelectorAll('td.original .original-text');
      const forms = [];
      esEls.forEach((el, k) => {
        const text = el.textContent;
        if (!text.trim()) return;
        const enEl = enEls[Math.min(k, enEls.length - 1)] || tr.querySelector('td.original');
        const en = enEl ? enEl.textContent : '';
        const r = Engine.proposeFixes(text, wl, { extras: 'linked', english: en, vset });
        if (r.fixes.length) forms.push({ text, en, fixes: r.fixes, formIndex: k });
      });
      if (!forms.length) return;
      const strong = forms.some((f) => f.fixes.some((x) => x.checked));
      const id = tr.getAttribute('row') || tr.id;
      items.push({ tr, id, index: i + 1, status: statusOf(tr), forms, strong });
      tr.setAttribute('data-gpfc', strong ? 'strong' : 'weak');
    });
    selected.clear();
    for (const it of items) if (it.strong) selected.add(it.id);
    scanned = true;
    setStatus(null);
    render();
  }

  // ------------------------------------------------------------------
  // panel (Shadow DOM so GlotPress CSS can't touch it)
  // ------------------------------------------------------------------
  let host, root, listEl, summaryEl, statusEl, prepareBtn, panelEl, toggleBtn;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
    .toggle { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; background: #1d2327; color: #fff;
      border: 0; border-radius: 22px; padding: 10px 16px; font-size: 14px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    .toggle:hover { background: #2c3338; }
    .toggle .count { background: #d63638; border-radius: 10px; padding: 1px 7px; margin-left: 8px; font-size: 12px; }
    .panel { position: fixed; left: 16px; bottom: 64px; width: min(620px, calc(100vw - 32px)); max-height: min(78vh, 760px);
      z-index: 2147483000; display: none; flex-direction: column; background: #fff; color: #1d2327;
      border: 1px solid #c3c4c7; border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.3); font-size: 13px; }
    .panel.open { display: flex; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #1d2327; color: #fff;
      border-radius: 8px 8px 0 0; }
    header h2 { margin: 0; font-size: 14px; font-weight: 600; }
    header button { background: transparent; border: 0; color: #fff; font-size: 18px; cursor: pointer; line-height: 1; }
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid #dcdcde; }
    button.btn { background: #f6f7f7; border: 1px solid #2271b1; color: #2271b1; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 13px; }
    button.btn:hover { background: #f0f6fc; }
    button.primary { background: #d63638; border-color: #d63638; color: #fff; font-weight: 600; padding: 8px 14px; }
    button.primary:hover { background: #b32d2e; }
    button.primary:disabled { background: #c3c4c7; border-color: #c3c4c7; cursor: not-allowed; }
    select { font-size: 13px; padding: 3px 4px; }
    .summary { padding: 8px 14px; color: #50575e; border-bottom: 1px solid #f0f0f1; }
    .list { overflow-y: auto; padding: 6px 10px; flex: 1; min-height: 80px; }
    .empty { padding: 18px 6px; color: #50575e; }
    .item { border: 1px solid #dcdcde; border-left-width: 4px; border-radius: 4px; padding: 8px 10px; margin: 8px 0; background: #fff; }
    .item.strong { border-left-color: #d63638; }
    .item.weak { border-left-color: #dba617; background: #fffdf5; }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .head input { width: 17px; height: 17px; margin: 0; cursor: pointer; }
    .chip { font-size: 11px; font-weight: 700; border-radius: 3px; padding: 1px 6px; color: #fff; }
    .chip.strong { background: #d63638; } .chip.weak { background: #dba617; }
    .chip.status { background: #f0f0f1; color: #50575e; font-weight: 500; }
    .go { margin-left: auto; font-size: 12px; background: none; border: 0; color: #2271b1; cursor: pointer; text-decoration: underline; padding: 0; }
    .lbl { display: inline-block; min-width: 78px; color: #787c82; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    .line { margin: 3px 0; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
    .line.en { color: #50575e; }
    mark { border-radius: 2px; padding: 0 1px; color: inherit; }
    mark.bad { background: #fcd6d6; } mark.weakm { background: #faf0c4; outline: 1px dashed #b78a00; }
    mark.good { background: #c9efd0; } mark.you { background: #cfe8ff; }
    .note { color: #787c82; font-size: 11.5px; margin-left: 78px; }
    .opts { padding: 8px 14px; border-top: 1px solid #dcdcde; display: grid; gap: 4px; }
    .opts label { display: flex; gap: 6px; align-items: flex-start; cursor: pointer; }
    footer { padding: 10px 14px; border-top: 1px solid #dcdcde; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .status { flex: 1 1 100%; font-size: 12.5px; }
    .status.err { color: #b32d2e; } .status.ok { color: #007017; } .status.info { color: #50575e; }
    .foot { color: #787c82; font-size: 11.5px; flex: 1; }
    a.opt { color: #2271b1; font-size: 12px; cursor: pointer; text-decoration: underline; }
  `;

  function buildShell() {
    host = h('div', { id: 'gpfc-host' });
    root = host.attachShadow({ mode: 'open' });
    root.append(h('style', { text: CSS }));
    toggleBtn = h('button', { class: 'toggle', onclick: () => togglePanel() });
    panelEl = h('div', { class: 'panel', role: 'dialog' });
    root.append(toggleBtn, panelEl);
    document.documentElement.append(host);
    renderChrome();
  }

  function togglePanel(force) {
    const open = force !== undefined ? force : !panelEl.classList.contains('open');
    panelEl.classList.toggle('open', open);
  }

  function renderChrome() {
    // toggle button
    toggleBtn.textContent = '';
    toggleBtn.append(L('toggle'));
    if (scanned) toggleBtn.append(h('span', { class: 'count', text: String(items.length) }));

    const wasOpen = panelEl.classList.contains('open');
    panelEl.textContent = '';
    const langSel = h('select', { onchange: (e) => { S.lang = e.target.value; saveLang(); renderChrome(); render(); } },
      h('option', { value: 'es', selected: S.lang === 'es' || null, text: 'Español' }),
      h('option', { value: 'en', selected: S.lang === 'en' || null, text: 'English' }));

    summaryEl = h('div', { class: 'summary' });
    listEl = h('div', { class: 'list' });
    statusEl = h('div', { class: 'status info' });
    prepareBtn = h('button', { class: 'btn primary', onclick: prepare });

    panelEl.append(
      h('header', null, h('h2', { text: L('title') }), h('button', { title: L('close'), onclick: () => togglePanel(false), text: '–' })),
      h('div', { class: 'bar' },
        h('button', { class: 'btn', onclick: scan, text: L('scan') }),
        h('button', { class: 'btn', onclick: () => { selected.clear(); items.forEach((i) => i.strong && selected.add(i.id)); render(); }, text: L('selStrong') }),
        h('button', { class: 'btn', onclick: () => { selected.clear(); render(); }, text: L('selNone') }),
        h('span', { style: 'margin-left:auto' }, h('span', { text: L('lang') + ': ' }), langSel)),
      summaryEl, listEl,
      h('div', { class: 'opts' },
        h('label', null, h('input', { type: 'checkbox', checked: S.detailed || null, onchange: (e) => { S.detailed = e.target.checked; saveSetting('detailed', S.detailed); renderChrome(); render(); } }), h('span', { text: L('detailed') })),
        h('label', { style: S.detailed ? '' : 'opacity:.5' }, h('input', { type: 'checkbox', checked: S.suggestedText || null, disabled: !S.detailed || null, onchange: (e) => { S.suggestedText = e.target.checked; saveSetting('suggestedText', S.suggestedText); } }), h('span', { text: L('suggestedText') })),
        h('label', null, h('input', { type: 'checkbox', checked: S.autoApply || null, onchange: (e) => { S.autoApply = e.target.checked; saveSetting('autoApply', S.autoApply); } }), h('span', { text: L('autoApply') }))),
      h('footer', null, statusEl, prepareBtn,
        h('span', { class: 'foot', text: L('footnote') }),
        h('a', { class: 'opt', onclick: () => api.runtime.sendMessage({ type: 'open-options' }), text: L('options') })));
    panelEl.classList.toggle('open', wasOpen);
    paintStatus();
  }

  function render() {
    renderChrome();
    const strongN = items.filter((i) => i.strong).length;
    if (!scanned) {
      summaryEl.textContent = '';
      listEl.append(h('div', { class: 'empty', text: L('scanFirst') }));
    } else {
      summaryEl.textContent = L('summary', { n: scannedRows, f: items.length, s: strongN, w: items.length - strongN });
      if (!items.length) listEl.append(h('div', { class: 'empty', text: L('none') }));
      for (const it of items) listEl.append(renderItem(it));
    }
    const n = items.filter((i) => selected.has(i.id)).length;
    prepareBtn.textContent = L('prepare', { n });
    prepareBtn.disabled = n === 0 || busy;
  }

  function renderItem(it) {
    const cb = h('input', { type: 'checkbox', checked: selected.has(it.id) || null, onchange: (e) => {
      if (e.target.checked) selected.add(it.id); else selected.delete(it.id);
      const n = items.filter((i) => selected.has(i.id)).length;
      prepareBtn.textContent = L('prepare', { n }); prepareBtn.disabled = n === 0 || busy;
    } });
    const card = h('div', { class: 'item ' + (it.strong ? 'strong' : 'weak') },
      h('div', { class: 'head' }, cb,
        h('strong', { text: '#' + it.index }),
        h('span', { class: 'chip ' + (it.strong ? 'strong' : 'weak'), text: it.strong ? L('strong') : L('weak') }),
        it.status ? h('span', { class: 'chip status', text: it.status }) : null,
        h('button', { class: 'go', text: L('goto'), onclick: () => flashRow(it) })));
    for (const form of it.forms) {
      const enRanges = [];
      const rx = /\byour(?:s|self)?\b|\byou(?:'re|'ve|'ll|'d|’re|’ve|’ll|’d)?\b/gi;
      for (const m of form.en.matchAll(rx)) enRanges.push({ start: m.index, end: m.index + m[0].length, cls: 'you' });
      const esRanges = form.fixes.map((f) => ({ start: f.start, end: f.end, cls: f.checked ? 'bad' : 'weakm' }));
      const checked = form.fixes.filter((f) => f.checked);
      const sugg = checked.length ? Engine.applyFixes(form.text, checked) : null;
      let sugEl = null;
      if (sugg !== null) {
        // highlight the replaced words in the suggestion
        const pieces = []; let pos = 0, out = '';
        for (const f of checked.slice().sort((a, b) => a.start - b.start)) {
          out += form.text.slice(pos, f.start); pieces.push({ start: out.length, end: out.length + f.replacement.length, cls: 'good' });
          out += f.replacement; pos = f.end;
        }
        sugEl = h('div', { class: 'line' }, h('span', { class: 'lbl', text: L('suggestion') }), marked(sugg, pieces, 'good'));
      }
      if (it.forms.length > 1 || form.formIndex > 0) card.append(h('div', { class: 'note', text: L('pluralForm', { n: form.formIndex + 1 }) }));
      card.append(
        h('div', { class: 'line en' }, h('span', { class: 'lbl', text: L('original') }), marked(form.en, enRanges, 'you')),
        h('div', { class: 'line' }, h('span', { class: 'lbl', text: L('translation') }), marked(form.text, esRanges, 'bad')),
        sugEl);
      const weakNotes = form.fixes.filter((f) => !f.checked).map((f) => f.original + ' → ' + f.replacement + ' (?)');
      if (weakNotes.length) card.append(h('div', { class: 'note', text: weakNotes.join(' · ') }));
    }
    return card;
  }

  function flashRow(it) {
    it.tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    it.tr.style.outline = '3px solid #2271b1';
    setTimeout(() => { it.tr.style.outline = ''; }, 1800);
  }

  // ------------------------------------------------------------------
  // status line
  // ------------------------------------------------------------------
  function setStatus(key, kind, vars) { lastStatus = { key, kind: kind || 'info', vars: vars || null }; paintStatus(); }
  function paintStatus() {
    if (!statusEl) return;
    statusEl.className = 'status ' + (lastStatus.kind || 'info');
    statusEl.textContent = lastStatus.key ? L(lastStatus.key, lastStatus.vars) : '';
  }

  async function saveSetting(key, value) {
    try {
      const r = await api.storage.local.get('settings');
      await api.storage.local.set({ settings: Object.assign({}, r.settings || {}, { [key]: value }) });
    } catch (e) { /* non-fatal */ }
  }
  const saveLang = () => saveSetting('lang', S.lang);

  // ------------------------------------------------------------------
  // "Prepare rejection"
  // ------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(150);
    }
  }
  function fire(el, types) { for (const type of types) el.dispatchEvent(new Event(type, { bubbles: true })); }

  function buildComment(chosen) {
    let block = '';
    if (S.detailed) {
      block = Feedback.buildSuggestions(chosen, S.lang, t, Engine.applyFixes, { includeText: S.suggestedText });
    }
    return Feedback.composeComment(S.templates[S.lang] || S.templates.en, block);
  }

  async function fillFeedbackWindow(comment, timeout) {
    const ta = await waitFor(() => document.querySelector('#modal_feedback_comment'), timeout);
    if (!ta) return false;
    await sleep(120);
    const style = document.querySelector('input[name="modal_feedback_reason"][value="style"]');
    if (style && !style.checked) style.click();
    ta.focus();
    ta.value = comment;
    fire(ta, ['input', 'change']);
    // point at the button that is now visible (Request changes) - never press it
    await sleep(150);
    const btn = ['#modal-requestchanges-btn', '#modal-reject-btn']
      .map((s) => document.querySelector(s)).find((b) => b && b.style.display !== 'none');
    if (btn) { btn.style.outline = '3px solid #d63638'; btn.style.outlineOffset = '2px'; btn.scrollIntoView({ block: 'nearest' }); }
    return true;
  }

  async function prepare() {
    if (busy) return;
    const chosen = items.filter((i) => selected.has(i.id));
    if (!chosen.length) { setStatus('errNothing', 'err'); return; }
    const bulk = document.querySelector('#bulk-action-top');
    const bulkForm = document.querySelector('#bulk-actions-toolbar-top');
    if (!bulk || !bulkForm) { setStatus('errNoBulk', 'err'); return; }
    if (![...bulk.options].some((o) => o.value === 'reject')) { setStatus('errNoReject', 'err'); return; }

    busy = true; prepareBtn.disabled = true;
    try {
      setStatus('selecting');
      const ids = new Set(chosen.map((c) => c.id));
      document.querySelectorAll('table#translations tr.preview').forEach((tr) => {
        const cb = tr.querySelector('th.checkbox input[type="checkbox"]');
        if (!cb) return;
        const want = ids.has(tr.getAttribute('row') || tr.id);
        if (cb.checked !== want) cb.click();
      });

      setStatus('choosing');
      bulk.value = 'reject';
      fire(bulk, ['input', 'change']);
      if (bulk.value !== 'reject') { setStatus('errNoReject', 'err'); return; }

      const comment = buildComment(chosen);
      if (S.autoApply) {
        setStatus('applying');
        const apply = bulkForm.querySelector('input[type="submit"], button[type="submit"]');
        if (!apply) { setStatus('errNoBulk', 'err'); return; }
        apply.click();
        const ok = await fillFeedbackWindow(comment, 12000);
        if (!ok) { setStatus('errNoModal', 'err'); return; }
      } else {
        setStatus('waitApply', 'info');
        togglePanel(false);
        const ok = await fillFeedbackWindow(comment, 180000);
        if (!ok) { setStatus('errNoModal', 'err'); return; }
      }
      togglePanel(false);                       // get out of the way of the feedback window
      setStatus('done', 'ok');
    } finally {
      busy = false;
      if (prepareBtn) prepareBtn.disabled = !items.some((i) => selected.has(i.id));
    }
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  async function boot() {
    if (!document.querySelector('table#translations')) return;      // not a translation list
    await loadSettings();
    const style = document.createElement('style');
    style.textContent = `
      tr.preview[data-gpfc="strong"] > td.translation { box-shadow: inset 0 0 0 2px #d63638; }
      tr.preview[data-gpfc="weak"] > td.translation { box-shadow: inset 0 0 0 2px #dba617; }`;
    document.head.append(style);
    buildShell();
    render();
    api.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'toggle') togglePanel(); });
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) { loadSettings().then(() => { renderChrome(); render(); }); }
    });
    if (S.autoScan) { scan(); togglePanel(true); }
  }
  boot();
})();
