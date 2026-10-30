// The module's HTML: a setup view and a play view. ui.js fills the lists.
export const markup = `
<section class="np-setup card" id="np-setup-view" aria-labelledby="np-h">
  <p class="np-eyebrow">Number puzzles</p>
  <h2 class="np-h" id="np-h">Number Place</h2>
  <p class="np-lede">Fill the grid so every row, column and box holds each number once. Every puzzle is proven to have one answer you can reach by logic alone, and every hint explains why.</p>
  <p class="np-actions">
    <button class="btn primary" type="button" id="np-continue" hidden><span>Continue <small id="np-continue-name"></small></span></button>
    <button class="btn" type="button" id="np-daily-btn">Today's puzzle</button>
  </p>
  <p class="np-help" id="np-daily-note"></p>
  <form id="np-setup" novalidate>
    <fieldset><legend>Difficulty</legend><div class="np-choices" id="np-levels"></div></fieldset>
    <fieldset><legend>Extra rules (optional)</legend><div class="np-choices chips" id="np-variants"></div></fieldset>
    <div class="np-gen-row">
      <button class="btn primary big" type="submit" id="np-gen">Start puzzle</button>
      <p class="np-status" id="np-status" role="status" aria-live="polite"></p>
    </div>
  </form>
  <div class="np-stats" id="np-stats"></div>
</section>

<section class="np-play" id="np-play-view" hidden>
  <div class="np-head">
    <h2 class="np-h" id="np-title">Number Place</h2>
    <div class="np-meta"><span class="np-time" aria-label="Time"><span id="np-time">0:00</span></span><span class="np-muted" id="np-progress"></span>
      <button class="btn quiet small" type="button" id="np-pause" aria-keyshortcuts="P">Pause</button></div>
  </div>
  <div class="np-layout">
    <div class="np-board-wrap">
      <div id="np-board" class="np-board" role="grid" aria-label="Number Place grid. Arrow keys move, number keys fill in."></div>
      <p class="np-paused-note" aria-hidden="true">Paused</p>
    </div>
    <div class="np-side">
      <div class="np-tools" role="toolbar" aria-label="Tools">
        <button class="btn small" type="button" id="np-undo" aria-keyshortcuts="Control+Z">Undo</button>
        <button class="btn small" type="button" id="np-redo" aria-keyshortcuts="Control+Y">Redo</button>
        <button class="btn small" type="button" id="np-erase" aria-keyshortcuts="Backspace">Erase</button>
        <button class="btn small" type="button" id="np-notes-btn" aria-pressed="false" aria-keyshortcuts="N">Notes <span class="state">Off</span></button>
        <button class="btn small" type="button" id="np-auto" aria-keyshortcuts="A">Fill notes</button>
        <button class="btn small" type="button" id="np-hint-btn" aria-keyshortcuts="H">Hint</button>
        <button class="btn small" type="button" id="np-check" aria-keyshortcuts="C">Check</button>
      </div>
      <div class="np-digits" id="np-digits" role="group" aria-label="Numbers"></div>
      <div class="np-hint card" id="np-hint" role="status" aria-live="polite" hidden></div>
      <label class="np-switch"><input type="checkbox" id="np-mistakes"> Show mistakes as I play</label>
      <details class="np-rules-box">
        <summary>Rules and keys</summary>
        <ul id="np-rules"></ul>
        <p class="np-help">Arrow keys move. 1 to 9 fills a cell, Shift with a number writes a note. N switches notes on and off, A fills in notes, H gives a hint, C checks, P pauses, Backspace erases, Ctrl+Z undoes.</p>
      </details>
      <p class="np-print-row"><button class="btn quiet small" type="button" id="np-print">Print</button><button class="btn quiet small" type="button" id="np-print-key">Print answer key</button><button class="btn quiet small" type="button" id="np-new">New puzzle</button></p>
    </div>
  </div>
  <section class="np-solved card" id="np-solved" hidden tabindex="-1" aria-labelledby="np-solved-h">
    <h2 id="np-solved-h">Solved!</h2>
    <p id="np-solved-text"></p>
    <p class="np-actions">
      <button class="btn primary" type="button" id="np-again">Another one like this</button>
      <button class="btn" type="button" id="np-share">Share my result</button>
      <button class="btn quiet" type="button" id="np-home">Back to setup</button>
    </p>
  </section>
  <p class="np-sr" id="np-live" aria-live="assertive"></p>
  <p class="np-sr" id="np-status-live" role="status" aria-live="polite"></p>
</section>`;
