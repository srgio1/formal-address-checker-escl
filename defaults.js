/* defaults.js - default settings + comment templates (shared by content script and options page) */
(function (root) {
  'use strict';
  const GLOSSARY = 'https://translate.wordpress.org/locale/es-cl/default/glossary/';
  const TEMPLATES = {
    es: 'Hola, esta traducción está usando el ustedeo como forma de tratamiento en singular. ' +
        'En es_CL se usa “tú” en vez de “usted”, sin voseo chileno. Gracias por traducir.{suggestions} ' +
        'Más información: ' + GLOSSARY,
    en: 'Hello, this translation is not following the forms of address allowed for es_CL. ' +
        'Please use informal for singular second person. Thank you for translating.{suggestions} ' +
        'More information: ' + GLOSSARY,
  };
  const uiLang = (() => {
    try { return ((root.browser || root.chrome).i18n.getUILanguage() || 'en').toLowerCase().startsWith('es') ? 'es' : 'en'; }
    catch (e) { return 'en'; }
  })();
  const DEFAULTS = {
    lang: uiLang,            // UI language AND feedback-comment language: 'es' | 'en'
    detailed: true,          // add the suggested changes (all prepared rows, merged) to the comment
    suggestedText: true,     // also add the full "Suggested translation" (single row only)
    autoApply: true,         // click Apply after choosing "Reject" (opens the feedback window)
    autoScan: false,         // scan the page as soon as it loads
    extraVerbs: '',          // extra formal verb forms, one per line
    templates: { es: TEMPLATES.es, en: TEMPLATES.en },
  };

  function merge(stored) {
    const s = stored || {};
    return Object.assign({}, DEFAULTS, s, {
      templates: Object.assign({}, DEFAULTS.templates, s.templates || {}),
    });
  }
  root.GPFC_DEFAULTS = DEFAULTS;
  root.GPFC_mergeSettings = merge;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DEFAULTS, merge, TEMPLATES };
})(typeof self !== 'undefined' ? self : this);
