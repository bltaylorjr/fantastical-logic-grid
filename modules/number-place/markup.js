// The module's HTML: a setup view, a play view and two dialogs. ui.js fills the lists.
export const markup = `
<section class="np-setup" id="np-setup-view" aria-labelledby="np-h">
  <div class="card np-setup-card">
    <p class="np-eyebrow">Number puzzles</p>
    <h2 class="np-h" id="np-h">Number Place</h2>
    <p class="np-lede">Fill the grid so every row, column and box holds each number once. Every puzzle is new to you, proven to have one answer you can reach by logic alone, and tuned to how you play.</p>
    <p class="np-actions">
      <button class="btn primary" type="button" id="np-continue" hidden><span>Continue <small id="np-continue-name"></small></span></button>
      <button class="btn" type="button" id="np-daily-btn">Today's puzzle</button>
      <button class="btn quiet" type="button" id="np-suggest" hidden></button>
    </p>
    <p class="np-help" id="np-daily-note"></p>
    <form id="np-setup" novalidate>
      <fieldset><legend>Difficulty</legend><div class="np-choices" id="np-levels"></div></fieldset>
      <fieldset id="np-size-field"><legend>Grid size</legend><div class="np-choices chips" id="np-sizes"></div></fieldset>
      <fieldset><legend>Extra rules (optional)</legend><div class="np-choices chips" id="np-variants"></div></fieldset>
      <details class="np-more" id="np-more">
        <summary>More options</summary>
        <div class="np-more-body">
          <div class="np-field"><label for="np-theme">Story theme</label><select id="np-theme"></select></div>
          <label class="np-switch"><input type="checkbox" id="np-silent"> Silent mode <small class="np-muted">grid only: no story, sound or animation</small></label>
          <label class="np-switch"><input type="checkbox" id="np-sound"> Sound effects</label>
          <label class="np-switch"><input type="checkbox" id="np-adapt"> Tune puzzles to how I play</label>
          <label class="np-switch"><input type="checkbox" id="np-autoclean"> Clear notes when I place a number</label>
          <label class="np-switch"><input type="checkbox" id="np-highlight"> Highlight the row, column, box and matching numbers</label>
        </div>
      </details>
      <div class="np-gen-row">
        <button class="btn primary big" type="submit" id="np-gen">Start puzzle</button>
        <p class="np-status" id="np-status" role="status" aria-live="polite"></p>
      </div>
      <p class="np-help" id="np-tuning-note"></p>
    </form>
  </div>

  <div class="np-setup-side">
    <section class="card" aria-labelledby="np-saved-h">
      <div class="np-row-head">
        <h3 id="np-saved-h">Saved puzzles</h3>
        <button class="btn quiet small" type="button" id="np-open-file">Open a puzzle file</button>
        <input type="file" id="np-file" accept=".json,application/json" hidden>
      </div>
      <p class="np-muted" id="np-saved-empty">Puzzles save as you play. Start one and it appears here.</p>
      <ul class="np-saved" id="np-saved"></ul>
      <p class="np-undo-bar" id="np-undo-bar" role="status" hidden><span id="np-undo-text"></span> <button class="btn small" type="button" id="np-undo-delete">Undo</button></p>
    </section>
    <section class="card" aria-labelledby="np-stats-h">
      <h3 id="np-stats-h">Stats and badges</h3>
      <div id="np-stats"></div>
      <ul class="np-badges" id="np-badges"></ul>
    </section>
  </div>
</section>

<section class="np-play" id="np-play-view" hidden>
  <div class="np-head">
    <div>
      <p class="np-eyebrow" id="np-kicker">Number Place</p>
      <h2 class="np-h" id="np-title">Number Place</h2>
    </div>
    <div class="np-meta"><span class="np-time" aria-label="Time"><span id="np-time">0:00</span></span><span class="np-muted" id="np-progress"></span>
      <button class="btn quiet small" type="button" id="np-pause" aria-keyshortcuts="P">Pause</button></div>
  </div>
  <p class="np-story" id="np-story"></p>
  <div class="np-coach card" id="np-coach" role="note" hidden>
    <p class="np-coach-h">Tip <span id="np-coach-n"></span></p>
    <p id="np-coach-text"></p>
    <p class="np-actions"><button class="btn small" type="button" id="np-coach-next">Next tip</button><button class="btn quiet small" type="button" id="np-coach-close">Got it</button></p>
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
      <p class="np-print-row">
        <button class="btn quiet small" type="button" id="np-print">Print…</button>
        <button class="btn quiet small" type="button" id="np-save-file">Save to a file</button>
        <button class="btn quiet small" type="button" id="np-reveal">Show the answer</button>
        <button class="btn quiet small" type="button" id="np-new">New puzzle</button>
      </p>
      <div class="np-confirm card" id="np-reveal-confirm" hidden>
        <p>Show the whole answer? This puzzle won't count as solved.</p>
        <p class="np-actions"><button class="btn small primary" type="button" id="np-reveal-yes">Show it</button><button class="btn quiet small" type="button" id="np-reveal-no">Keep going</button></p>
      </div>
    </div>
  </div>
  <section class="np-solved card" id="np-solved" hidden tabindex="-1" aria-labelledby="np-solved-h">
    <h2 id="np-solved-h">Solved!</h2>
    <p class="np-ending" id="np-ending"></p>
    <p id="np-solved-text"></p>
    <div class="np-feel" id="np-feel" role="group" aria-labelledby="np-feel-h">
      <p id="np-feel-h">How did that feel?</p>
      <button class="btn small" type="button" data-feel="easy">Too easy</button>
      <button class="btn small" type="button" data-feel="right">About right</button>
      <button class="btn small" type="button" data-feel="hard">Too hard</button>
      <span class="np-muted" id="np-feel-done" role="status"></span>
    </div>
    <p class="np-new-badges" id="np-new-badges" hidden></p>
    <p class="np-actions">
      <button class="btn primary" type="button" id="np-again">Next puzzle</button>
      <button class="btn" type="button" id="np-share">Share my result</button>
      <button class="btn" type="button" id="np-steps-btn">Watch the solution</button>
      <button class="btn quiet" type="button" id="np-home">Back to setup</button>
    </p>
    <div class="np-share-box" id="np-share-box" hidden>
      <p class="np-help">Hold or right-click the picture to save or copy it. The text below is copied for you.</p>
      <div id="np-share-pic"></div>
    </div>
  </section>
  <p class="np-sr" id="np-live" aria-live="assertive"></p>
  <p class="np-sr" id="np-status-live" role="status" aria-live="polite"></p>
</section>

<dialog class="np-dialog" id="np-print-dlg" aria-labelledby="np-print-h">
  <form method="dialog">
    <h2 id="np-print-h">Print</h2>
    <fieldset><legend>Grid</legend>
      <label class="np-switch"><input type="radio" name="np-pmarks" value="blank" checked> Blank puzzle</label>
      <label class="np-switch"><input type="radio" name="np-pmarks" value="marks"> With my numbers</label>
    </fieldset>
    <fieldset><legend>Paper</legend>
      <label class="np-switch"><input type="radio" name="np-paper" value="letter" checked> Letter</label>
      <label class="np-switch"><input type="radio" name="np-paper" value="a4"> A4</label>
    </fieldset>
    <label class="np-switch"><input type="checkbox" id="np-p-key" checked> Answer key on its own page</label>
    <label class="np-switch"><input type="checkbox" id="np-p-steps"> Step-by-step solution</label>
    <p class="np-actions"><button class="btn primary" value="print" id="np-print-go">Print</button><button class="btn quiet" value="cancel">Cancel</button></p>
  </form>
</dialog>

<dialog class="np-dialog wide" id="np-steps-dlg" aria-labelledby="np-steps-h">
  <h2 id="np-steps-h">The solution, step by step</h2>
  <div class="np-steps-layout">
    <div class="np-board np-mini" id="np-steps-board" aria-hidden="true"></div>
    <div>
      <p class="np-eyebrow" id="np-step-n"></p>
      <p class="np-step-tech" id="np-step-tech"></p>
      <p id="np-step-why" aria-live="polite"></p>
      <p class="np-actions">
        <button class="btn small" type="button" id="np-step-prev">Back</button>
        <button class="btn small primary" type="button" id="np-step-next">Next step</button>
        <button class="btn quiet small" type="button" id="np-step-end">Jump to the end</button>
      </p>
    </div>
  </div>
  <form method="dialog"><p class="np-actions"><button class="btn quiet">Close</button></p></form>
</dialog>`;
