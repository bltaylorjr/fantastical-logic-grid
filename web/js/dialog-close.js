// A close (X) button in the top corner of every dialog, so a long one such as
// Settings closes without scrolling to its bottom buttons. It acts like Escape:
// the dialog's own cancel handler runs first and can keep it open (a required
// screen name), and openDialog puts focus back where it was.
const X = '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>';

export function closeDialog(dlg) {
  if (!dlg.open) return;
  if (dlg.dispatchEvent(new Event('cancel', { cancelable: true }))) dlg.close();
}

export function addCloseButtons(root = document) {
  for (const dlg of root.querySelectorAll('dialog')) {
    if (dlg.querySelector(':scope > .dlg-x')) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dlg-x';
    b.setAttribute('aria-label', 'Close');
    b.title = 'Close';
    b.innerHTML = X;
    b.addEventListener('click', () => closeDialog(dlg));
    dlg.prepend(b);
  }
}
