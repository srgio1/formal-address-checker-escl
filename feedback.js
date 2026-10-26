/* feedback.js - builds the rejection comment (pure functions, unit-testable) */
(function (root) {
  'use strict';
  const Q = (s) => '“' + s + '”';

  /**
   * items: one row or an array of rows; row.forms: [{text, fixes:[{original, replacement, checked}]}]
   * Only fixes that are ticked by default (HIGH / MEDIUM / ENGLISH) are listed; unconfirmed ones
   * (REVIEW / EXTRA) are never put in front of a translator.
   * Word-level changes from all rows are merged into ONE line, separated by "; " (duplicates removed).
   * The full "Suggested translation" is added only for a single row (opts.includeText !== false),
   * because with several rows the comment would become far too long.
   */
  function buildSuggestions(items, lang, t, applyFixes, opts) {
    items = Array.isArray(items) ? items : [items];
    const includeText = !opts || opts.includeText !== false;
    const pairs = [];
    const seen = new Set();
    const fullTexts = [];
    for (const item of items) {
      for (const form of item.forms) {
        const chosen = form.fixes.filter((f) => f.checked);
        if (!chosen.length) continue;
        for (const f of chosen) {
          const key = f.original + '\u0000' + f.replacement;
          if (!seen.has(key)) { seen.add(key); pairs.push(Q(f.original) + ' → ' + Q(f.replacement)); }
        }
        fullTexts.push(applyFixes(form.text, chosen));
      }
    }
    if (!pairs.length) return '';
    let out = t(lang, 'sugChanges') + ': ' + pairs.join('; ') + '.';
    const total = fullTexts.join(' ').length;
    if (includeText && items.length === 1 && fullTexts.length === 1 && total <= 600) {
      out += '\n' + t(lang, 'sugText') + ': ' + Q(fullTexts[0].trim());
    }
    return out;
  }

  /** template may contain {suggestions}; otherwise the block is appended at the end */
  function composeComment(template, block) {
    if (/\{suggestions\}/.test(template)) {
      return template.replace(/\s*\{suggestions\}\s*/, block ? '\n\n' + block + '\n\n' : ' ').trim();
    }
    return (block ? template.trim() + '\n\n' + block : template).trim();
  }

  const api = { buildSuggestions, composeComment };
  root.GPFC_Feedback = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
