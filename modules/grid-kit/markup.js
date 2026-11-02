// The game screen's HTML for each kit game: a setup view, a play view and its
// dialogs. Every id starts with the game's id, so several games can sit on one page.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function markup(def) {
  const P = def.id;
  const digits = def.kind === 'digits';
  return `
<section class="gk-setup" id="${P}-setup-view" aria-labelledby="${P}-h">
  <div class="card gk-setup-card">
    <p class="gk-eyebrow">${esc(def.eyebrow)}</p>
    <h2 class="gk-h" id="${P}-h" translate="no">${esc(def.name)}</h2>
    <p class="gk-lede">${esc(def.lede)}</p>
    <p class="gk-actions">
      <button class="btn primary" type="button" id="${P}-continue" hidden><span>Continue <small id="${P}-continue-name"></small></span></button>
      <button class="btn" type="button" id="${P}-daily-btn">Today's puzzle</button>
      <button class="btn quiet" type="button" id="${P}-suggest" hidden></button>
      <button class="btn quiet" type="button" id="${P}-howto-btn">How to play</button>
    </p>
    <p class="gk-help" id="${P}-daily-note"></p>
    <form id="${P}-setup" novalidate>
      <fieldset><legend>Difficulty</legend><div class="gk-choices" id="${P}-levels"></div></fieldset>
      <fieldset id="${P}-size-field"><legend>Grid size</legend><div class="gk-choices chips" id="${P}-sizes"></div></fieldset>
      <details class="gk-more">
        <summary>More options</summary>
        <div class="gk-more-body">
          <label class="gk-switch"><input type="checkbox" id="${P}-silent"> Silent mode <small class="gk-muted">grid only: no story, sound or animation</small></label>
          <label class="gk-switch"><input type="checkbox" id="${P}-sound"> Sound effects</label>
          <label class="gk-switch"><input type="checkbox" id="${P}-adapt"> Tune puzzles to how I play</label>
          ${digits ? `<label class="gk-switch"><input type="checkbox" id="${P}-autoclean"> Clear notes when I place a number</label>` : `<label class="gk-switch"><input type="checkbox" id="${P}-autocross"> Cross out the rest of a line when it is finished</label>`}
          <label class="gk-switch"><input type="checkbox" id="${P}-highlight"> ${digits ? 'Highlight related cells and matching numbers' : 'Highlight the row and column I am on'}</label>
        </div>
      </details>
      <div class="gk-gen-row">
        <button class="btn primary big" type="submit" id="${P}-gen">Start puzzle</button>
        <p class="gk-status" id="${P}-status" role="status" aria-live="polite"></p>
      </div>
      <p class="gk-help" id="${P}-tuning-note"></p>
    </form>
  </div>

  <div class="gk-setup-side">
    <section class="card" aria-labelledby="${P}-saved-h">
      <div class="gk-row-head">
        <h3 id="${P}-saved-h">Saved puzzles</h3>
        <button class="btn quiet small" type="button" id="${P}-open-file">Open a puzzle file</button>
        <input type="file" id="${P}-file" accept=".json,application/json" hidden>
      </div>
      <p class="gk-muted" id="${P}-saved-empty">Puzzles save as you play. Start one and it appears here.</p>
      <ul class="gk-saved" id="${P}-saved"></ul>
      <p class="gk-undo-bar" id="${P}-undo-bar" role="status" hidden><span id="${P}-undo-text"></span> <button class="btn small" type="button" id="${P}-undo-delete">Undo</button></p>
    </section>
    ${def.gallery ? `<section class="card" aria-labelledby="${P}-gallery-h"><h3 id="${P}-gallery-h">Your picture gallery</h3><p class="gk-muted" id="${P}-gallery-empty">Every picture you uncover is kept here.</p><ul class="gk-gallery" id="${P}-gallery"></ul></section>` : ''}
    <section class="card" aria-labelledby="${P}-stats-h">
      <h3 id="${P}-stats-h">Stats and badges</h3>
      <div id="${P}-stats"></div>
      <ul class="gk-badges" id="${P}-badges"></ul>
    </section>
  </div>
</section>

<section class="gk-play" id="${P}-play-view" hidden>
  <div class="gk-head">
    <div>
      <p class="gk-eyebrow" id="${P}-kicker"></p>
      <h2 class="gk-h" id="${P}-title"></h2>
    </div>
    <div class="gk-meta"><span class="gk-time" aria-label="Time"><span id="${P}-time">0:00</span></span><span class="gk-muted" id="${P}-progress"></span>
      <button class="btn quiet small" type="button" id="${P}-pause" aria-keyshortcuts="P">Pause</button></div>
  </div>
  <p class="gk-story" id="${P}-story"></p>
  <div class="gk-coach card" id="${P}-coach" role="note" hidden>
    <p class="gk-coach-h">Tip <span id="${P}-coach-n"></span></p>
    <p id="${P}-coach-text"></p>
    <p class="gk-actions"><button class="btn small" type="button" id="${P}-coach-next">Next tip</button><button class="btn quiet small" type="button" id="${P}-coach-close">Got it</button></p>
  </div>
  <div class="gk-layout">
    <div class="gk-board-wrap">
      <div id="${P}-board" class="gk-board gk-${P}" role="grid" aria-label="${esc(def.name)} grid. ${esc(def.boardHelp)}"></div>
      <p class="gk-paused-note" aria-hidden="true">Paused</p>
    </div>
    <div class="gk-side">
      <div class="gk-tools" role="toolbar" aria-label="Tools">
        <button class="btn small" type="button" id="${P}-undo" aria-keyshortcuts="Control+Z">Undo</button>
        <button class="btn small" type="button" id="${P}-redo" aria-keyshortcuts="Control+Y">Redo</button>
        <button class="btn small" type="button" id="${P}-erase" aria-keyshortcuts="Backspace">Erase</button>
        ${digits ? `<button class="btn small" type="button" id="${P}-notes-btn" aria-pressed="false" aria-keyshortcuts="N">Notes <span class="state">Off</span></button>
        <button class="btn small" type="button" id="${P}-auto" aria-keyshortcuts="A">Fill notes</button>` : ''}
        <button class="btn small" type="button" id="${P}-hint-btn" aria-keyshortcuts="H">Hint</button>
        <button class="btn small" type="button" id="${P}-check" aria-keyshortcuts="C">Check</button>
      </div>
      ${digits ? `<div class="gk-digits" id="${P}-digits" role="group" aria-label="Numbers"></div>` : `<div class="gk-paint" role="group" aria-label="Pen">
        <button class="btn gk-pen" type="button" id="${P}-pen-fill" aria-pressed="true" aria-keyshortcuts="F"><span class="gk-swatch fill" aria-hidden="true"></span> Shade</button>
        <button class="btn gk-pen" type="button" id="${P}-pen-cross" aria-pressed="false" aria-keyshortcuts="X"><span class="gk-swatch cross" aria-hidden="true">×</span> Cross</button>
      </div>
      <p class="gk-help">Tap a cell, or drag along a row or column to mark several. Tap a marked cell again to clear it.</p>`}
      <div class="gk-hint card" id="${P}-hint" role="status" aria-live="polite" hidden></div>
      <label class="gk-switch"><input type="checkbox" id="${P}-mistakes"> Show mistakes as I play</label>
      <details class="gk-rules-box">
        <summary>Rules and keys</summary>
        <ul id="${P}-rules"></ul>
        <p><button class="btn small" type="button" id="${P}-howto-play">How to play</button></p>
        <p class="gk-help">${esc(def.keysHelp)}</p>
      </details>
      <p class="gk-print-row">
        <button class="btn quiet small" type="button" id="${P}-print">Print…</button>
        <button class="btn quiet small" type="button" id="${P}-save-file">Save to a file</button>
        <button class="btn quiet small" type="button" id="${P}-reveal">Show the answer</button>
        <button class="btn quiet small" type="button" id="${P}-new">New puzzle</button>
      </p>
      <div class="gk-confirm card" id="${P}-reveal-confirm" hidden>
        <p>Show the whole answer? This puzzle won't count as solved.</p>
        <p class="gk-actions"><button class="btn small primary" type="button" id="${P}-reveal-yes">Show it</button><button class="btn quiet small" type="button" id="${P}-reveal-no">Keep going</button></p>
      </div>
    </div>
  </div>
  <section class="gk-solved card" id="${P}-solved" hidden tabindex="-1" aria-labelledby="${P}-solved-h">
    <h2 id="${P}-solved-h">Solved!</h2>
    <p class="gk-ending" id="${P}-ending"></p>
    <p id="${P}-solved-text"></p>
    <div class="gk-feel" role="group" aria-labelledby="${P}-feel-h">
      <p id="${P}-feel-h">How did that feel?</p>
      <button class="btn small" type="button" data-feel="easy">Too easy</button>
      <button class="btn small" type="button" data-feel="right">About right</button>
      <button class="btn small" type="button" data-feel="hard">Too hard</button>
      <span class="gk-muted" id="${P}-feel-done" role="status"></span>
    </div>
    <p class="gk-new-badges" id="${P}-new-badges" hidden></p>
    <p class="gk-actions">
      <button class="btn primary" type="button" id="${P}-again">Next puzzle</button>
      <button class="btn" type="button" id="${P}-share">Share my result</button>
      <button class="btn" type="button" id="${P}-steps-btn">Watch the solution</button>
      <button class="btn quiet" type="button" id="${P}-home">Back to setup</button>
    </p>
    <div class="gk-share-box" id="${P}-share-box" hidden>
      <p class="gk-help">Hold or right-click the picture to save or copy it. The text below is copied for you.</p>
      <div id="${P}-share-pic"></div>
    </div>
  </section>
  <p class="gk-sr" id="${P}-live" aria-live="assertive"></p>
  <p class="gk-sr" id="${P}-status-live" role="status" aria-live="polite"></p>
</section>

<dialog class="gk-dialog" id="${P}-print-dlg" aria-labelledby="${P}-print-h">
  <form method="dialog">
    <h2 id="${P}-print-h">Print</h2>
    <fieldset><legend>Grid</legend>
      <label class="gk-switch"><input type="radio" name="${P}-pmarks" value="blank" checked> Blank puzzle</label>
      <label class="gk-switch"><input type="radio" name="${P}-pmarks" value="marks"> With my marks</label>
    </fieldset>
    <fieldset><legend>Paper</legend>
      <label class="gk-switch"><input type="radio" name="${P}-paper" value="letter" checked> Letter</label>
      <label class="gk-switch"><input type="radio" name="${P}-paper" value="a4"> A4</label>
    </fieldset>
    <label class="gk-switch"><input type="checkbox" id="${P}-p-key" checked> Answer key on its own page</label>
    <label class="gk-switch"><input type="checkbox" id="${P}-p-steps"> Step-by-step solution</label>
    <p class="gk-actions"><button class="btn primary" value="print">Print</button><button class="btn quiet" value="cancel">Cancel</button></p>
  </form>
</dialog>

<dialog class="gk-dialog wide" id="${P}-howto-dlg" aria-labelledby="${P}-howto-h">
  <h2 id="${P}-howto-h">How to play ${esc(def.name)}</h2>
  <div class="gk-howto" id="${P}-howto-body" tabindex="0"></div>
  <form method="dialog"><p class="gk-actions"><button class="btn quiet">Close</button></p></form>
</dialog>

<dialog class="gk-dialog wide" id="${P}-steps-dlg" aria-labelledby="${P}-steps-h">
  <h2 id="${P}-steps-h">The solution, step by step</h2>
  <div class="gk-steps-layout">
    <div class="gk-board gk-mini gk-${P}" id="${P}-steps-board" aria-hidden="true"></div>
    <div>
      <p class="gk-eyebrow" id="${P}-step-n"></p>
      <p class="gk-step-tech" id="${P}-step-tech"></p>
      <p id="${P}-step-why" aria-live="polite"></p>
      <p class="gk-actions">
        <button class="btn small" type="button" id="${P}-step-prev">Back</button>
        <button class="btn small primary" type="button" id="${P}-step-next">Next step</button>
        <button class="btn quiet small" type="button" id="${P}-step-end">Jump to the end</button>
      </p>
    </div>
  </div>
  <form method="dialog"><p class="gk-actions"><button class="btn quiet">Close</button></p></form>
</dialog>`;
}
