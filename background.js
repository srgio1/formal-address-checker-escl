/* background.js - toolbar button toggles the panel; content script asks us to open the options page */
const api = typeof browser !== 'undefined' ? browser : chrome;
api.action.onClicked.addListener((tab) => {
  api.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => { /* not a translate.wordpress.org es-CL page */ });
});
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'open-options') return api.runtime.openOptionsPage();
});
