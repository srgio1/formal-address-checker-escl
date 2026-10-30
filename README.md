# GlotPress Formal-Address Checker (es-CL)

Firefox extension for translate.wordpress.org (Spanish – Chile). It finds translations that
address the user as "usted", lets you review them, and prepares the "Reject with Feedback"
window (reason: Style Guide + comment). **You always press the final "Request changes" button.**

## Install (temporary, for testing)
1. Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
2. Choose `manifest.json` from this folder. (It is removed when Firefox restarts.)

## Install (permanent)
Firefox only keeps unsigned add-ons in Developer/Nightly builds. For regular Firefox, sign it
as a private (unlisted) add-on at https://addons.mozilla.org/developers/ (free): upload the .zip
and choose "On your own". Then install the signed .xpi.

## Use
1. Open a translation list for `es-cl` (e.g. `…/es-cl/default/?filters[status]=waiting`).
2. Click the dark **Revisar usted/tú** button (bottom-left) → **Escanear esta página**.
3. Review the cards: red = strong, yellow = weak. Untick what you don't want to reject.
4. **Preparar rechazo (N)** → rows are selected, *Reject* chosen, Apply pressed, *Style Guide*
   ticked and the comment written. Check it and press **Request changes**.

The comment can list the suggested changes of every prepared row in one line (separated by `;`, duplicates removed). The full “Suggested translation” is added only when a single row is prepared, and can be turned off.

Only the rows on the current page are scanned. Language (Español/English) switches both the
interface and the comment. Comments, extra verbs and behaviour are in the add-on's Options.

