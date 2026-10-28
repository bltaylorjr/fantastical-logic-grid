// Every dialog gets the close (X) button the welcome and Introduction have in
// index.html, so a long one such as Settings closes without scrolling to its
// bottom buttons. app.js handles the click with closeDialog, which acts like
// Escape: the dialog's own cancel handler runs first and can keep it open (a
// required screen name), and openDialog puts focus back where it was.
const X = '<svg class="ico" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

export function closeDialog(dlg) {
  if (!dlg?.open) return;
  if (dlg.dispatchEvent(new Event('cancel', { cancelable: true }))) dlg.close();
}

export function addCloseButtons(root = document) {
  for (const dlg of root.querySelectorAll('dialog')) {
    if (dlg.querySelector(':scope > .dlg-x')) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dlg-x';
    b.setAttribute('aria-label', 'Close');
    b.title = 'Close (Esc)';
    b.innerHTML = X;
    dlg.prepend(b);
  }
}
