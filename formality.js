/*
 * formality.js - JavaScript port of the PO Formality Checker engine
 * (formality_core.py + formality_fixer.py).
 *
 * Detects "usted" address in Spanish translations and proposes the "tú"
 * form, using the English original ("you"/"your") as a hint.
 *
 * No DOM access here, so it can be unit-tested in Node and compared with the
 * Python version on the same strings.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Unicode-aware helpers (JS \b only knows ASCII letters)
  // ------------------------------------------------------------------
  const WORD_CHARS = '\\p{L}\\p{N}_';
  const B_START = '(?<![' + WORD_CHARS + '])';
  const B_END = '(?![' + WORD_CHARS + '])';
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const WORD_RE_SRC = '[A-Za-zÀ-ÖØ-öø-ÿ]+';
  const words = (s) => s.match(new RegExp(WORD_RE_SRC, 'g')) || [];

  const ACCENT_FROM = 'áéíóúüÁÉÍÓÚÜ';
  const ACCENT_TO = 'aeiouuAEIOUU';
  function stripAccents(s) {
    let out = '';
    for (const c of s) {
      const i = ACCENT_FROM.indexOf(c);
      out += i >= 0 ? ACCENT_TO[i] : c;
    }
    return out;
  }

  const isUpper = (s) => s.length > 0 && s === s.toUpperCase() && s !== s.toLowerCase();
  const isLowerChar = (c) => c === c.toLowerCase();

  /** regex.search(text, pos) */
  function searchFrom(re, text, pos) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    g.lastIndex = pos;
    return g.exec(text);
  }

  const CLITIC_SUFFIXES = [
    'selo', 'sela', 'selos', 'selas', 'melo', 'mela', 'melos', 'melas',
    'telo', 'tela', 'telos', 'telas', 'noslo', 'nosla', 'noslos', 'noslas',
    'los', 'las', 'les', 'lo', 'la', 'le', 'nos', 'me', 'te', 'se',
  ];
  const CLITICS_BY_LEN = CLITIC_SUFFIXES.slice().sort((a, b) => b.length - a.length);
  const SENTENCE_END_RE = /[.!?\n]/g;

  // ------------------------------------------------------------------
  // Detection (formality_core.scan_text)
  // ------------------------------------------------------------------
  function buildWordPattern(word) {
    return new RegExp(B_START + '(' + escRe(word) + '(?:' + CLITICS_BY_LEN.join('|') + ')?)' + B_END, 'giu');
  }

  function isCapitalizedWord(surface) {
    if (!surface) return false;
    const c = surface[0];
    return c === c.toUpperCase() && c !== c.toLowerCase() && !isUpper(surface);
  }

  function verbMatchSpans(text, formalVerbs) {
    const seen = new Set();
    const spans = [];
    for (const word of formalVerbs) {
      for (const m of text.matchAll(buildWordPattern(word))) {
        const key = m.index + ':' + (m.index + m[0].length);
        if (!seen.has(key)) { seen.add(key); spans.push([m.index, m.index + m[0].length]); }
      }
    }
    const bare = new Set();
    for (const w of formalVerbs) { const n = stripAccents(w); if (n.length >= 4) bare.add(n); }
    for (const m of text.matchAll(new RegExp(WORD_RE_SRC, 'g'))) {
      const key = m.index + ':' + (m.index + m[0].length);
      if (seen.has(key)) continue;
      const tok = m[0].toLowerCase();
      if (!/[áéíóú]/.test(tok)) continue;
      const tn = stripAccents(tok);
      for (const suf of CLITICS_BY_LEN) {
        if (tn.length > suf.length && tn.endsWith(suf) && bare.has(tn.slice(0, -suf.length))) {
          seen.add(key); spans.push([m.index, m.index + m[0].length]); break;
        }
      }
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return spans;
  }

  /** wordlist: {pronoun, formal_verbs, conjunctions, polite_leadin, always_formal} (arrays or Sets) */
  function scanText(text, wl) {
    const findings = [];
    if (!text) return findings;
    const pronounWords = wl.pronoun || [];
    const formalVerbs = wl.formal_verbs || [];
    const conjunctions = wl.conjunctions || [];
    const politeLeadins = wl.polite_leadin || [];
    const alwaysFormal = wl.always_formal || [];
    if (!(pronounWords.length || formalVerbs.length || alwaysFormal.length)) return findings;

    for (const word of pronounWords) {
      const re = new RegExp(B_START + '(' + escRe(word) + ')' + B_END, 'giu');
      for (const m of text.matchAll(re)) {
        findings.push({ word: m[0], confidence: 'HIGH', note: 'Formal pronoun.', kind: 'pronoun',
                        start: m.index, end: m.index + m[0].length });
      }
    }

    const alwaysSpans = [];
    for (const phrase of alwaysFormal) {
      const re = new RegExp(B_START + phrase.split(/\s+/).map(escRe).join('\\s+') + B_END, 'giu');
      for (const m of text.matchAll(re)) {
        findings.push({ word: m[0], confidence: 'HIGH', kind: 'phrase',
                        note: "Formal phrasing (uses the 'usted'-register dative 'le' or a formal set phrase).",
                        start: m.index, end: m.index + m[0].length });
        alwaysSpans.push([m.index, m.index + m[0].length]);
      }
    }

    for (const [start, end] of verbMatchSpans(text, formalVerbs)) {
      if (alwaysSpans.some(([a, b]) => a <= start && end <= b)) continue;
      const surface = text.slice(start, end);

      let sentenceStart = 0;
      const head = text.slice(0, start);
      for (const se of head.matchAll(SENTENCE_END_RE)) sentenceStart = se.index + 1;
      const preceding = text.slice(sentenceStart, start);
      const precedingStripped = preceding.replace(/^[ ¿¡"'“”—\-\t]+|[ ¿¡"'“”—\-\t]+$/g, '');
      const isSentenceInitial = precedingStripped === '';
      const isCapitalized = isCapitalizedWord(surface);

      const precedingLower = preceding.toLowerCase();
      let politeHit = null;
      for (const phrase of politeLeadins) {
        if (precedingLower.includes(phrase)) { politeHit = phrase; break; }
      }
      const precedingWords = words(preceding).map((w) => w.toLowerCase()).slice(-4);
      const precedingJoined = precedingWords.join(' ');
      let conjHit = null;
      for (const conj of conjunctions) {
        if (conj.includes(' ')) { if (precedingJoined.includes(conj)) { conjHit = conj; break; } }
        else if (precedingWords.includes(conj)) { conjHit = conj; break; }
      }

      let confidence, note;
      if (politeHit) { confidence = 'HIGH'; note = "Preceded by politeness marker '" + politeHit + "' - confirms a direct command."; }
      else if (conjHit) { confidence = 'LOW'; note = "Preceded by '" + conjHit + "' - likely an ordinary subjunctive in a subordinate clause."; }
      else if (isSentenceInitial || isCapitalized) { confidence = 'HIGH'; note = (isSentenceInitial ? 'Sentence-initial' : 'Capitalized') + " imperative - very likely a direct 'usted' command."; }
      else { confidence = 'MEDIUM'; note = 'Lowercase, mid-sentence verb form - could be a formal command or an ordinary subjunctive.'; }

      findings.push({ word: surface, confidence, note, kind: 'verb', start, end });
    }
    findings.sort((a, b) => a.start - b.start);
    return findings;
  }

  // ------------------------------------------------------------------
  // Orthography helpers (accent placement after adding clitics)
  // ------------------------------------------------------------------
  const VOWELS = 'aeiouáéíóúü';
  const STRONGISH = 'aeoáéíóú';
  const isVowel = (c) => c !== undefined && VOWELS.includes(c);

  function nuclei(w) {
    const res = [];
    let i = 0;
    const n = w.length;
    while (i < n) {
      if (isVowel(w[i])) {
        let j = i + 1;
        while (j < n && isVowel(w[j])) j++;
        let cur = i;
        for (let p = i + 1; p < j; p++) {
          if (STRONGISH.includes(w[p - 1]) && STRONGISH.includes(w[p])) { res.push([cur, p]); cur = p; }
        }
        res.push([cur, j]);
        i = j;
      } else i++;
    }
    return res;
  }

  function stressIndex(word) {
    const nu = nuclei(word);
    for (let k = 0; k < nu.length; k++) {
      const [s, e] = nu[k];
      if (/[áéíóú]/.test(word.slice(s, e))) return k;
    }
    return Math.max(nu.length - 2, 0);
  }

  const ACCENT_CHAR = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

  function placeAccent(word, stressIdx) {
    const nu = nuclei(word);
    if (!nu.length) return word;
    stressIdx = Math.min(stressIdx, nu.length - 1);
    const chars = Array.from(word).map((c) => ({ 'á': 'a', 'é': 'e', 'ó': 'o' }[c] || c));
    const [s, e] = nu[stressIdx];
    if (chars.slice(s, e).some((c) => 'íú'.includes(c))) return chars.join('');
    const nSyl = nu.length;
    const fromEnd = nSyl - stressIdx;
    const last = word[word.length - 1].toLowerCase();
    let need;
    if (nSyl === 1) need = false;
    else if (fromEnd === 1) need = 'aeiouns'.includes(last);
    else if (fromEnd === 2) need = !'aeiouns'.includes(last);
    else need = true;
    if (need) {
      const vows = [];
      for (let k = s; k < e; k++) if (isVowel(chars[k])) vows.push(k);
      let pick = vows.find((k) => 'aeo'.includes(chars[k]));
      if (pick === undefined) pick = vows[vows.length - 1];
      chars[pick] = ACCENT_CHAR[chars[pick]] || chars[pick];
    }
    return chars.join('');
  }

  function matchCase(original, replacement) {
    if (!replacement) return replacement;
    if (original.length > 1 && isUpper(original)) return replacement.toUpperCase();
    if (original[0] !== original[0].toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
  }

  // ------------------------------------------------------------------
  // usted-command -> tú conversion
  // ------------------------------------------------------------------
  const IRREG_IMPERATIVE = {
    haga: 'haz', vaya: 've', tenga: 'ten', ponga: 'pon', diga: 'di', salga: 'sal', venga: 'ven',
    sea: 'sé', sepa: 'sabe', este: 'está', de: 'da', mantenga: 'mantén', obtenga: 'obtén',
    detenga: 'detén', oiga: 'oye', traiga: 'trae', caiga: 'cae', valga: 'vale',
    satisfaga: 'satisface', siga: 'sigue', envie: 'envía', continue: 'continúa', actue: 'actúa',
  };
  const IRREG_SUBJUNCTIVE = { este: 'estés', de: 'des', envie: 'envíes', continue: 'continúes', actue: 'actúes' };
  const SUBJUNCTIVE_ONLY = new Set(['sea', 'este', 'de', 'sepa', 'valga']);

  const CLITIC_UNITS = {
    selo: ['se', 'lo'], sela: ['se', 'la'], selos: ['se', 'los'], selas: ['se', 'las'],
    melo: ['me', 'lo'], mela: ['me', 'la'], melos: ['me', 'los'], melas: ['me', 'las'],
    telo: ['te', 'lo'], tela: ['te', 'la'], telos: ['te', 'los'], telas: ['te', 'las'],
    noslo: ['nos', 'lo'], nosla: ['nos', 'la'], noslos: ['nos', 'los'], noslas: ['nos', 'las'],
    los: ['los'], las: ['las'], les: ['les'], lo: ['lo'], la: ['la'], le: ['le'],
    nos: ['nos'], me: ['me'], te: ['te'], se: ['se'],
  };

  function regularImperative(core) {
    if (core.endsWith('zca')) return core.slice(0, -3) + 'ce';
    if (core.endsWith('uya')) return core.slice(0, -1) + 'e';
    if (core.endsWith('ja')) return core.slice(0, -2) + 'ge';
    if (core.endsWith('gue')) return core.slice(0, -3) + 'ga';
    if (core.endsWith('que')) return core.slice(0, -3) + 'ca';
    if (core.endsWith('ce')) return core.slice(0, -2) + 'za';
    if (core.endsWith('e')) return core.slice(0, -1) + 'a';
    if (core.endsWith('a')) return core.slice(0, -1) + 'e';
    return null;
  }

  function analyzeVerb(surface, vset) {
    const sn = stripAccents(surface.toLowerCase());
    if (vset.has(sn) && sn.endsWith('se') && sn.length >= 9 && 'ea'.includes(sn[sn.length - 3])) return [sn.slice(0, -2), ['se']];
    if (vset.has(sn)) return [sn, []];
    for (const suf of CLITICS_BY_LEN) {
      if (sn.length > suf.length && sn.endsWith(suf) && vset.has(sn.slice(0, -suf.length))) {
        return [sn.slice(0, -suf.length), CLITIC_UNITS[suf]];
      }
    }
    if (sn.endsWith('se') && sn.length > 6 && 'ea'.includes(sn[sn.length - 3])) return [sn.slice(0, -2), ['se']];
    return null;
  }

  function convertVerb(surface, mood, vset) {
    const parsed = analyzeVerb(surface, vset);
    if (!parsed) return null;
    const core = parsed[0];
    const clit = parsed[1];
    const low = surface.toLowerCase();
    let stress = /[áéíóú]/.test(low) ? stressIndex(low) : stressIndex(core);
    if (clit.length) mood = 'imperative';

    if (mood === 'subjunctive') {
      let out = IRREG_SUBJUNCTIVE[core];
      if (out === undefined) out = placeAccent(core + 's', stress);
      return matchCase(surface, out);
    }
    let base = IRREG_IMPERATIVE[core];
    if (base === undefined) {
      base = regularImperative(core);
      if (base === null) return null;
      base = placeAccent(base, stress);
    } else {
      stress = stressIndex(base);
    }
    if (clit.length) {
      let units = clit.slice();
      if (units.length === 1 && units[0] === 'se') units = ['te'];
      return matchCase(surface, placeAccent(base + units.join(''), stress));
    }
    return matchCase(surface, base);
  }

  // ------------------------------------------------------------------
  // Context analysis
  // ------------------------------------------------------------------
  const S = (a) => new Set(a);
  const NOUN_GUARD = S(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'este', 'esta',
    'estos', 'estas', 'ese', 'esa', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'nuestro', 'nuestra', 'nuestros',
    'nuestras', 'otro', 'otra', 'cada', 'algún', 'ningún']);
  const SUBORDINATORS = S(['que', 'cuando', 'aunque', 'quien', 'quienes', 'donde', 'como', 'porque',
    'mientras', 'ojalá', 'ojala', 'quizá', 'quiza', 'quizás', 'quizas']);
  const ALLOWED_BETWEEN = S(['no', 'ya', 'nunca', 'siempre', 'también', 'tambien', 'solo', 'sólo', 'aún', 'aun',
    'todavía', 'todavia', 'lo', 'la', 'los', 'las', 'me', 'te', 'nos', 'y', 'o', 'e', 'u', 'ni', 'luego',
    'después', 'despues', 'primero', 'correctamente']);
  const COORDINATORS = S(['y', 'o', 'e', 'u', 'ni']);
  const FIRST_PERSON = S(['mi', 'mis', 'yo']);
  const BOUNDARY_CHARS = ',;:.!?¿¡\n()<>';
  const SOFT_BOUNDARY = ',;:';

  function clauseBefore(text, start) {
    const pre = text.slice(0, start);
    let cut = -1;
    for (const ch of BOUNDARY_CHARS) cut = Math.max(cut, pre.lastIndexOf(ch));
    const boundary = cut >= 0 ? pre[cut] : null;
    return [words(pre.slice(cut + 1)).map((w) => w.toLowerCase()), boundary];
  }

  // ------------------------------------------------------------------
  // English hints
  // ------------------------------------------------------------------
  const R = (src, flags) => new RegExp(src, flags === undefined ? 'i' : flags);
  const YOU = R(String.raw`\byou\b`);
  const YOUR = R(String.raw`\byours?\b`);
  const THIRD_POSS = R(String.raw`\b(?:their|theirs|its|his|hers?)\b|\b(?!(?:it|let|that|what|here|there|who|he|she|where|how|when|why)\b)[a-z]+'s\b`);
  const THIRD_OBJ = R(String.raw`\b(?:him|them|her)\b`);
  const CONJ_YOU = R(String.raw`\b(?:unless|until|till|so that|so|that|if|when|whenever|whether|before|after|once|as soon as|while|where|what|which|how|in case|as long as|provided that)\s+you\b`);
  const IT = R(String.raw`\bit\b`);
  const EN_IMPERATIVE = R(String.raw`(?:^|[.!?:;,]\s*|\b(?:and|then|or)\s+)(?:please\s+)?(?:click|select|choose|search|follow|enter|press|open|go|tap|check|copy|paste|save|add|create|find|visit|sign|log|navigate|switch|enable|disable|turn|set|use|make|ensure|contact|read|see|refer|try|update|upgrade|activate|download|upload|insert|type|fill|specify|provide|review|confirm|continue|refresh|remember|note|keep|stay|take|be|wait|install|connect|map|assign|reduce|increase)\b`);
  const EN_STRONG_IMPERATIVE = R(String.raw`\b(?:click|select|choose|enter|press|tap|copy|paste|follow|navigate|search\s+for|sign\s+in|log\s+in)\b`);

  function analyzeEnglish(msgid) {
    if (!msgid) return null;
    const t = msgid.replace(/\u2019/g, "'");
    return {
      text: t, you: YOU.test(t), your: YOUR.test(t), third_poss: THIRD_POSS.test(t), third_obj: THIRD_OBJ.test(t),
      conj_you: CONJ_YOU.test(t), it_obj: IT.test(t), imperative: EN_IMPERATIVE.test(t) || EN_STRONG_IMPERATIVE.test(t),
    };
  }

  const CONNECTORS = [
    [/(?:hasta|till) que$/, String.raw`(?:until|till)\s+you`],
    [/a menos que$/, String.raw`unless\s+you`],
    [/para que$/, String.raw`(?:so\s+that|so|in\s+order\s+that)\s+you|for\s+you\s+to`],
    [/antes de que$/, String.raw`before\s+you`],
    [/des?pu[eé]s de que$/, String.raw`(?:after|once)\s+you`],
    [/en caso de que$/, String.raw`(?:in\s+case|if)\s+you`],
    [/siempre que$/, String.raw`(?:whenever|as\s+long\s+as|provided\s+that|if)\s+you`],
    [/cuando$/, String.raw`(?:when|whenever|once|as\s+soon\s+as)\s+you`],
    [/mientras$/, String.raw`while\s+you`],
    [/aunque$/, String.raw`(?:although|though|even\s+if)\s+you`],
    [/(?:donde|como)$/, String.raw`(?:where|how|as)\s+you`],
  ];
  const GENERIC_CONNECTOR = R(String.raw`\b(?:that|what|which|how|if|whether|so\s+that|so|hope|wish|trust|expect|believe|think)\s+you\b|\b(?:ask|asks|asking|asked|requires?|requiring|prompts?|prompting|invit\w+|remind\w*|tell\w*|urg\w+|encourag\w+|allows?|lets?)\s+you\s+to\b`);

  function subjunctiveConfirmed(en, ws, subIdx) {
    if (!en) return false;
    const phrase = ws.slice(Math.max(0, subIdx - 2), subIdx + 1).join(' ');
    for (const [rx, pat] of CONNECTORS) {
      if (rx.test(phrase)) return new RegExp(String.raw`\b(?:` + pat + String.raw`)\b`, 'i').test(en.text);
    }
    return GENERIC_CONNECTOR.test(en.text);
  }

  const MOD = String.raw`(?:\s+(?:also|still|only|now|really|already|do\s+not|don't|did\s+not|didn't|will\s+not|won't|cannot))*`;
  const ALIGN = {
    'está': R(String.raw`\byou(?:'re|\s+are|\s+were)\b`),
    'ha': R(String.raw`\byou(?:'ve|\s+have|\s+had)\b(?!\s+(?:got\s+)?to\b)`),
    'puede': R(String.raw`\byou(?:\s+(?:will|'ll))?` + MOD + String.raw`\s*(?:can|could|may|might|cannot|can't)\b|\byou(?:'re|\s+are|'ll\s+be|\s+will\s+be)\s+able\b`),
    'desea': R(String.raw`\byou` + MOD + String.raw`\s+(?:want|wish|would\s+like|like)\b|\byou'd\s+like\b`),
    'necesita': R(String.raw`\byou` + MOD + String.raw`\s+(?:need|require)\b|\byou'll\s+need\b`),
    'debe': R(String.raw`\byou` + MOD + String.raw`\s+(?:must|should|ought|have\s+to|need\s+to)\b|\byou'll\s+(?:need|have)\s+to\b`),
    'tiene': R(String.raw`\byou` + MOD + String.raw`\s+(?:have|need)\b|\byou've\b`),
    'hace': R(String.raw`\byou` + MOD + String.raw`\s+(?:click|make|do|perform)\b`),
    'usa': R(String.raw`\byou` + MOD + String.raw`\s+use\b|\byou(?:'re|\s+are)\s+using\b`),
    'elige': R(String.raw`\byou` + MOD + String.raw`\s+(?:choose|select|pick|opt|decide)\b`),
    'prefiere': R(String.raw`\byou\s+(?:\w+\s+)?prefer\b`),
    'sabe': R(String.raw`\byou` + MOD + String.raw`\s+know\b|\byou(?:'re|\s+are)\s+familiar\b`),
    'verá': R(String.raw`\byou(?:'ll|\s+will)?\s+(?:see|notice)\b`),
    'recibirá': R(String.raw`\byou(?:'ll|\s+will)\s+(?:receive|get)\b`),
    'tendrá': R(String.raw`\byou(?:'ll|\s+will)\s+(?:have|need)\b`),
  };
  ALIGN['podrá'] = ALIGN['puede'];
  ALIGN['podría'] = R(String.raw`\b(?:could|would)\s+you\b|\byou\s+(?:could|would)\b`);
  ALIGN['deberá'] = ALIGN['debe'];
  ALIGN['quiere'] = ALIGN['desea'];
  ALIGN['utiliza'] = ALIGN['usa'];
  ALIGN['conoce'] = ALIGN['sabe'];

  const YOU_ADVERBS = S(['ahora', 'actualmente', 'aquí', 'aqui', 'además', 'ademas', 'también', 'tambien', 'luego',
    'entonces', 'continuación', 'continuacion', 'siempre', 'nunca', 'ya', 'aún', 'aun', 'todavía', 'todavia',
    'solo', 'sólo', 'incluso', 'opcionalmente', 'automáticamente', 'automaticamente', 'posteriormente',
    'después', 'despues', 'primero', 'finalmente', 'inmediatamente', 'manualmente', 'fácilmente', 'facilmente',
    'normalmente']);
  const CONJ_SEG = S(['si', 'que', 'cuando', 'donde', 'como', 'mientras', 'aunque', 'porque', 'pero', 'y', 'o', 'e', 'u', 'ni', 'pues']);
  const ANIMATE = S(['desea', 'quiere', 'prefiere', 'elige', 'sabe', 'conoce']);
  const HINT_ONLY = S(['ha', 'está', 'hace']);

  const INDICATIVE = {
    puede: 'puedes', desea: 'deseas', quiere: 'quieres', tiene: 'tienes', necesita: 'necesitas', usa: 'usas',
    utiliza: 'utilizas', elige: 'eliges', prefiere: 'prefieres', debe: 'debes', sabe: 'sabes', conoce: 'conoces',
    'podrá': 'podrás', 'deberá': 'deberás', 'tendrá': 'tendrás', 'recibirá': 'recibirás', 'verá': 'verás',
    ha: 'has', 'está': 'estás', hace: 'haces', 'podría': 'podrías',
  };
  const INDICATIVE_LEADIN = S(['si', 'que', 'cuando', 'donde', 'como', 'mientras', 'aunque', 'no', 'ni']);

  const SU_RE = new RegExp(B_START + '(su|sus)' + B_END, 'giu');
  const LE_RE = new RegExp(B_START + 'le' + B_END, 'giu');
  const INF_LE_RE = new RegExp(B_START + '([A-Za-zÀ-ÿ]+(?:ar|er|ir|ando|iendo|yendo|ándo|iéndo))le' + B_END, 'giu');
  const WORD_TOKEN_SRC = '[A-Za-zÀ-ÖØ-öø-ÿ]+';

  const SKIP_AFTER_USTED = S(['lo', 'la', 'los', 'las', 'le', 'les', 'se', 'me', 'te', 'nos', 'no', 'ya', 'también', 'tambien']);
  const FUNCTION_WORDS = S(['que', 'de', 'a', 'en', 'y', 'o', 'para', 'por', 'con', 'sin', 'el', 'la', 'los', 'las', 'un', 'una', 'si', 'como', 'cuando', 'se']);
  const ACCENT_DEPENDENT = S(['de', 'este']);

  const verbsetN = (wl) => new Set((wl.formal_verbs || []).map(stripAccents));

  function isVerbToken(tok, vset) {
    if (ACCENT_DEPENDENT.has(tok.toLowerCase())) return false;
    return analyzeVerb(tok, vset) !== null;
  }

  function thirdToSecond(word) {
    const w = word.toLowerCase();
    let out;
    if (w === 'es') out = 'eres';
    else if (w === 'ha') out = 'has';
    else if (w === 'está') out = 'estás';
    else if (w.endsWith('ó')) return null;
    else out = w + 's';
    return matchCase(word, out);
  }

  function mkFix(start, end, original, replacement, kind, tier, checked, note) {
    return { start, end, original, replacement, kind, tier, checked, note: note || '' };
  }

  function fixUsted(text, hit) {
    const s = hit.start, e = hit.end;
    const noteOk = "'usted' removed; verb put in 2nd person singular - check the sentence.";
    let pos = e, verb = null;
    for (;;) {
      const m = searchFrom(new RegExp(WORD_TOKEN_SRC), text, pos);
      if (!m || text.slice(pos, m.index).replace(/^ +| +$/g, '') !== '') break;
      const tok = m[0];
      if (SKIP_AFTER_USTED.has(tok.toLowerCase())) { pos = m.index + m[0].length; continue; }
      if (!FUNCTION_WORDS.has(tok.toLowerCase())) verb = m;
      break;
    }
    if (verb) {
      const newV = thirdToSecond(verb[0]);
      if (newV) {
        const before = text.slice(0, s).replace(/ +$/, '');
        const start = before.length;
        const lead = text.slice(start, s).startsWith(' ') ? ' ' : '';
        let newTxt = lead + text.slice(e, verb.index).replace(/^ +/, '') + newV;
        if (before === '' || '.!?¿¡'.includes(before.slice(-1))) {
          newTxt = newTxt.replace(/^ +/, '');
          newTxt = newTxt.slice(0, 1).toUpperCase() + newTxt.slice(1);
        }
        return mkFix(start, verb.index + verb[0].length, text.slice(start, verb.index + verb[0].length), newTxt,
                     'pronoun', 'HIGH', true, noteOk);
      }
    }
    const pre = text.slice(0, s).replace(/ +$/, '');
    let last = null;
    for (const m of pre.matchAll(new RegExp(WORD_TOKEN_SRC, 'g'))) last = m;
    if (last && last.index + last[0].length === pre.length && !FUNCTION_WORDS.has(last[0].toLowerCase())) {
      const newV = thirdToSecond(last[0]);
      if (newV) return mkFix(last.index, e, text.slice(last.index, e), newV, 'pronoun', 'HIGH', true, noteOk);
    }
    return mkFix(s, e, text.slice(s, e), matchCase(text.slice(s, e), 'tú'), 'pronoun', 'HIGH', false,
                 "'usted' -> 'tú'; the verb agreement needs a manual check.");
  }

  function fixPhrase(text, hit, vset) {
    const surface = text.slice(hit.start, hit.end);
    const first = new RegExp('^' + WORD_TOKEN_SRC).exec(surface);
    if (!first) return null;
    const tok = first[0];
    let newFirst;
    if (tok.toLowerCase() === 'le') newFirst = matchCase(tok, 'te');
    else { newFirst = convertVerb(tok, 'imperative', vset); if (newFirst === null) return null; }
    return mkFix(hit.start, hit.end, surface, newFirst + surface.slice(first[0].length), 'phrase', 'HIGH', true,
                 'Formal set phrase -> informal.');
  }

  // ------------------------------------------------------------------
  // proposeFixes (formality_fixer.propose_fixes)
  // ------------------------------------------------------------------
  function proposeFixes(text, wl, opts) {
    opts = opts || {};
    const extras = opts.extras || 'linked';
    const useEnglish = opts.useEnglish !== false;
    const fixes = [];
    const skipped = [];
    if (!text) return { fixes, skipped };
    const en = (opts.english && useEnglish) ? analyzeEnglish(opts.english) : null;
    const hits = scanText(text, wl);
    const vset = opts.vset || verbsetN(wl);
    const hasHigh = hits.some((h) => h.confidence === 'HIGH');
    const firstPerson = words(text).some((w) => FIRST_PERSON.has(w.toLowerCase()));

    for (const h of hits) {
      const kind = h.kind || 'verb';
      const surface = text.slice(h.start, h.end);
      if (kind === 'pronoun') { if (surface.toLowerCase() === 'usted') fixes.push(fixUsted(text, h)); continue; }
      if (kind === 'phrase') {
        const f = fixPhrase(text, h, vset);
        if (f) fixes.push(f); else skipped.push("'" + surface + "': no conversion rule");
        continue;
      }

      const [ws, boundary] = clauseBefore(text, h.start);
      const prev = ws.length ? ws[ws.length - 1] : null;
      if (prev !== null && NOUN_GUARD.has(prev)) { skipped.push("'" + surface + "': looks like a noun/adjective after '" + prev + "'"); continue; }

      const parsed = analyzeVerb(surface, vset);
      if (!parsed) { skipped.push("'" + surface + "': could not analyse"); continue; }
      const core = parsed[0];
      const clit = parsed[1];

      let subIdx = null;
      ws.forEach((w, i) => { if (SUBORDINATORS.has(w)) subIdx = i; });
      let mood;
      if (subIdx === null) mood = 'imperative';
      else {
        const seg = ws.slice(subIdx + 1);
        const segCore = seg.filter((w) => !ALLOWED_BETWEEN.has(w) && !isVerbToken(w, vset));
        if (!segCore.length) mood = 'subjunctive';
        else if (prev !== null && COORDINATORS.has(prev) && !seg.some((w) => isVerbToken(w, vset))) mood = 'imperative';
        else { skipped.push("'" + surface + "': subordinate clause with its own subject (not addressed to the user)"); continue; }
      }
      if (clit.length) mood = 'imperative';
      if (mood === 'imperative' && SUBJUNCTIVE_ONLY.has(core) && h.confidence !== 'HIGH') {
        skipped.push("'" + surface + "': ambiguous form, left alone"); continue;
      }
      const nw = convertVerb(surface, mood, vset);
      if (nw === null || nw === surface) { skipped.push("'" + surface + "': no conversion rule"); continue; }

      if (mood === 'subjunctive') {
        let note = 'Subordinate verb -> tú subjunctive. Check that the subject really is the user.';
        if (firstPerson) note += " (String uses 'mi/mis': it may be written in the user's own voice.)";
        if (subjunctiveConfirmed(en, ws, subIdx)) {
          fixes.push(mkFix(h.start, h.end, surface, nw, 'subjunctive', 'ENGLISH', true,
            "Subordinate verb -> tú subjunctive. English ('...if/unless/until you...') confirms the subject is the user."));
        } else fixes.push(mkFix(h.start, h.end, surface, nw, 'subjunctive', 'REVIEW', false, note));
      } else if (h.confidence === 'HIGH') {
        fixes.push(mkFix(h.start, h.end, surface, nw, 'imperative', 'HIGH', true, 'Direct command -> tú imperative.'));
      } else {
        const strong = ws.length === 0 && boundary !== null && SOFT_BOUNDARY.includes(boundary);
        fixes.push(mkFix(h.start, h.end, surface, nw, 'imperative', 'MEDIUM',
          !!(hasHigh || strong || (en && (en.you || en.your || en.imperative))),
          'Command inside a longer sentence -> tú imperative.'));
      }
    }

    const extrasOk = extras === 'all' || (extras === 'linked' && fixes.length > 0);
    const taken = fixes.map((f) => [f.start, f.end]);
    const free = (a, b) => !taken.some(([ta, tb]) => a < tb && ta < b);
    const add = (start, end, orig, rep, kind, tier, checked, note) => {
      fixes.push(mkFix(start, end, orig, rep, kind, tier, checked, note));
      taken.push([start, end]);
    };
    const decide = (positive, negative, whyYes, whyNo, label) => {
      if (en && positive && !negative) return ['ENGLISH', whyYes];
      if (en && negative && !positive) { skipped.push("'" + label + "': " + whyNo); return null; }
      return (extras !== 'off' && extrasOk) ? ['EXTRA', null] : null;
    };

    for (const m of text.matchAll(SU_RE)) {
      const a = m.index, b = m.index + m[0].length;
      if (!free(a, b)) continue;
      const d = decide(en && en.your, en && en.third_poss,
        "English has 'your' (and no their/its/his/her) -> tu/tus.", 'English says their/its/his/her (third person)', m[0]);
      if (d) {
        const rep = matchCase(m[0], m[0].toLowerCase() === 'su' ? 'tu' : 'tus');
        add(a, b, m[0], rep, 'possessive', d[0], d[0] === 'ENGLISH',
          d[1] || 'su/sus -> tu/tus. Only if it refers to the user, not a third party.');
      }
    }
    for (const [rx, kind] of [[INF_LE_RE, 'inf'], [LE_RE, 'le']]) {
      for (const m of text.matchAll(rx)) {
        const a = m.index, b = m.index + m[0].length;
        if (!free(a, b)) continue;
        const d = decide(en && en.you, en && (en.third_obj || en.it_obj),
          "English has 'you' (and no him/her/them) -> te.", 'English says him/her/them/it (third person)', m[0]);
        if (!d) continue;
        let rep, note = d[1];
        if (kind === 'inf') { rep = m[1] + matchCase(m[0].slice(-2), 'te'); note = note || "-le -> -te. Only if 'le' is the user."; }
        else { rep = matchCase(m[0], 'te'); note = note || "le -> te. Only if 'le' is the user."; }
        add(a, b, m[0], rep, 'clitic', d[0], d[0] === 'ENGLISH', note);
      }
    }
    for (const m of text.matchAll(new RegExp(WORD_TOKEN_SRC, 'g'))) {
      const w = m[0], key = w.toLowerCase();
      const a = m.index, b = m.index + w.length;
      if (!Object.prototype.hasOwnProperty.call(INDICATIVE, key) || !free(a, b)) continue;
      const [ws] = clauseBefore(text, a);
      const prev = ws.length ? ws[ws.length - 1] : null;
      if (prev !== null && (NOUN_GUARD.has(prev) || prev === 'se')) continue;
      const rep = matchCase(w, INDICATIVE[key]);
      let cut = -1;
      ws.forEach((x, i) => { if (CONJ_SEG.has(x)) cut = i; });
      const subjectGuard = ws.slice(cut + 1).some((x) => NOUN_GUARD.has(x));
      const youPosition = !subjectGuard && (prev === null || INDICATIVE_LEADIN.has(prev) || ALLOWED_BETWEEN.has(prev) ||
        YOU_ADVERBS.has(prev) || prev === 'pero' || prev === 'porque');
      const aligned = !!(en && Object.prototype.hasOwnProperty.call(ALIGN, key) && ALIGN[key].test(en.text));
      const impersonal = key === 'está' && /^\s+(?:todo|toda)\b/i.test(text.slice(b));
      if (aligned && subjectGuard && !ANIMATE.has(key)) { skipped.push("'" + w + "': the subject is explicit (a noun phrase), not the user"); continue; }
      if (aligned && impersonal) add(a, b, w, rep, 'indicative', 'EXTRA', false, "Impersonal 'está todo listo' - the tú version is usually 'estás listo'. Edit by hand.");
      else if (aligned && (ANIMATE.has(key) || youPosition)) add(a, b, w, rep, 'indicative', 'ENGLISH', true, "English has 'you' + the matching verb -> 2nd person singular.");
      else if (aligned && extras !== 'off') add(a, b, w, rep, 'indicative', 'EXTRA', false, "English has 'you' + this verb, but the subject here is unclear.");
      else if (HINT_ONLY.has(key)) continue;
      else if (extras !== 'off' && extrasOk && prev !== null && INDICATIVE_LEADIN.has(prev)) add(a, b, w, rep, 'indicative', 'EXTRA', false, '3rd -> 2nd person singular. Only if the subject is the user.');
    }

    const prio = { pronoun: 0, phrase: 0, imperative: 1, subjunctive: 1 };
    const accepted = [];
    const order = fixes.slice().sort((x, y) => ((prio[x.kind] ?? 2) - (prio[y.kind] ?? 2)) || (x.start - y.start));
    for (const f of order) {
      if (!accepted.some((a) => f.start < a.end && a.start < f.end)) accepted.push(f);
    }
    accepted.sort((x, y) => x.start - y.start);
    return { fixes: accepted, skipped };
  }

  function applyFixes(text, fixes) {
    let out = text;
    for (const f of fixes.slice().sort((a, b) => b.start - a.start)) out = out.slice(0, f.start) + f.replacement + out.slice(f.end);
    return out;
  }

  const api = { stripAccents, scanText, proposeFixes, applyFixes, convertVerb, analyzeEnglish, verbsetN, TIERS: ['HIGH', 'MEDIUM', 'ENGLISH', 'REVIEW', 'EXTRA'] };
  root.FormalityEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
