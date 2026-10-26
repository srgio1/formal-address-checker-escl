const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);
let current = GPFC_mergeSettings({});

function paintLabels() {
  const l = $('lang').value;
  document.documentElement.lang = l;
  for (const id of ['optTitle', 'optLang', 'optDetailed', 'optSuggestedText', 'optAutoApply', 'optAutoScan', 'optExtraVerbs',
                    'optExtraVerbsHelp', 'optTemplateEs', 'optTemplateEn', 'optTemplateHelp']) $(id).textContent = GPFC_t(l, id);
  $('save').textContent = GPFC_t(l, 'save');
  $('reset').textContent = GPFC_t(l, 'resetTemplates');
}

async function load() {
  const r = await api.storage.local.get('settings');
  current = GPFC_mergeSettings(r.settings);
  $('lang').value = current.lang;
  $('detailed').checked = current.detailed;
  $('suggestedText').checked = current.suggestedText;
  $('autoApply').checked = current.autoApply;
  $('autoScan').checked = current.autoScan;
  $('extraVerbs').value = current.extraVerbs;
  $('tplEs').value = current.templates.es;
  $('tplEn').value = current.templates.en;
  paintLabels();
}

$('lang').addEventListener('change', paintLabels);
$('reset').addEventListener('click', () => {
  $('tplEs').value = GPFC_DEFAULTS.templates.es;
  $('tplEn').value = GPFC_DEFAULTS.templates.en;
});
$('save').addEventListener('click', async () => {
  const settings = {
    lang: $('lang').value, detailed: $('detailed').checked, suggestedText: $('suggestedText').checked, autoApply: $('autoApply').checked,
    autoScan: $('autoScan').checked, extraVerbs: $('extraVerbs').value,
    templates: { es: $('tplEs').value, en: $('tplEn').value },
  };
  await api.storage.local.set({ settings });
  $('msg').textContent = GPFC_t(settings.lang, 'saved');
  setTimeout(() => { $('msg').textContent = ''; }, 2500);
});
load();
