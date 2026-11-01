// The website's Educators page (educators/): the request form for free
// printable puzzle packages, its how-to video, and answers to common
// questions. seo.mjs builds it into dist/site only (never the desktop app).
// Every choice comes from engine/src/classroom.js; seo/educators.js runs the
// form (school email code, sending) against the game's Worker.
import { esc } from './worksheet.mjs';

export function educatorsBody(up, { options: o, api, video }) {
  const sizeOpts = [];
  for (let k = o.printLimits.categories[0]; k <= o.printLimits.categories[1]; k++) {
    for (let n = o.printLimits.items[0]; n <= o.printLimits.items[1]; n++) sizeOpts.push(`<option value="${k}x${n}">${k} categories × ${n} items</option>`);
  }
  const themeRows = o.themes.map((t) => `<li class="theme-row"><label class="check"><input type="checkbox" name="theme" value="${t.id}"> <span><b>${esc(t.name)}</b> <span class="muted">${esc(t.description)}</span></span></label>
<label class="topic"><span class="sr-only">${esc(t.name)} topic</span><select name="topic-${t.id}" aria-label="${esc(t.name)} topic"><option value="any">Any ${esc(t.name.toLowerCase())} topic</option>${t.topics.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></li>`).join('');
  const catBlock = (i) => `<fieldset class="cat-block" data-cat="${i}"><legend>Category ${i + 1}${i < 2 ? '' : ' (optional)'}</legend>
<div class="grid2"><label>Category name<input name="cat-name-${i}" maxlength="30" autocomplete="off" placeholder="${['Project', 'Helper', 'Ribbon', 'Snack'][i]}"></label>
<label>Items, one per line or separated by commas (3 to 8)<textarea name="cat-items-${i}" rows="3" placeholder="${['Volcano, Solar Oven, Robot Arm', 'Grandma, Coach, Neighbor', '1st place, 2nd place, 3rd place', 'Apple, Pretzels, Cheese'][i]}"></textarea></label></div>
<details><summary>Wording and order (optional)</summary>
<div class="grid2"><label>How to say a match: "Maya ___ Volcano"<input name="cat-pos-${i}" maxlength="40" autocomplete="off" placeholder="built the"></label>
<label>How to say "not a match": "Maya ___ Volcano"<input name="cat-neg-${i}" maxlength="40" autocomplete="off" placeholder="did not build the"></label></div>
<label class="check"><input type="checkbox" name="cat-ordered-${i}"> <span>The items are in order (times, ages, places), listed first to last</span></label>
<div class="grid2"><label>The order runs<select name="cat-order-${i}">${Object.entries(o.orderWords).map(([k, w]) => `<option value="${k}">${w.least} to ${w.most}</option>`).join('')}</select></label>
<label>Or your own comparison, both ways<input name="cat-less-${i}" maxlength="40" autocomplete="off" placeholder="placed ahead of"><input name="cat-more-${i}" maxlength="40" autocomplete="off" placeholder="placed behind" aria-label="The other way"></label></div>
</details></fieldset>`;
  return `<h1>Free logic puzzle packages for educators</h1>
<p class="lede">Ask for a set of printable story logic grid puzzles made for your class: the grade level, difficulty, themes and number of puzzles you choose, or a theme you write yourself. Every puzzle has a new story and exactly one answer, and comes with an answer key. Free for schools.</p>
<ol class="steps how">
<li><strong>Fill in the form</strong> below with your school email and the puzzles you want.</li>
<li><strong>Confirm your school email</strong> with the 6-digit code we send you.</li>
<li><strong>Our team reviews</strong> your request, usually within a day or two.</li>
<li><strong>Your PDFs arrive by email</strong>, ready to print: the puzzles, and the answer keys in their own file.</li>
</ol>
${video ? `<h2 id="video-h">Watch how it works</h2>
<p class="muted">${video.minutes}-minute narrated video, with captions: from filling in the form to the PDF in your inbox.</p>
<video controls preload="none" playsinline poster="educators-poster.jpg" aria-labelledby="video-h"><source src="educators.mp4" type="video/mp4"><track kind="captions" srclang="en" label="English" src="educators.en.vtt" default></video>
<details class="transcript"><summary>Read the video transcript</summary>${video.transcript.map((t) => `<p>${esc(t)}</p>`).join('')}</details>` : ''}

<noscript><p class="note">The request form needs JavaScript. You can still print this week's free worksheets from <a href="${up}printables/">Printables</a>.</p></noscript>
<div id="edu-paused" class="note" hidden role="status"></div>

<form id="edu-form" class="edu" novalidate data-api="${esc(api || '')}">
<h2 id="form-h">Request a puzzle package</h2>
<p class="muted">Fields marked * are needed. Everything else has a sensible choice already.</p>
<div id="edu-errors" class="errors" role="alert" tabindex="-1" hidden></div>

<fieldset><legend>About you</legend>
<div class="grid2">
<label>Your name *<input name="name" autocomplete="name" maxlength="80" required></label>
<label>School email address *<input name="email" type="email" autocomplete="email" maxlength="254" required aria-describedby="email-help"></label>
</div>
<p class="help" id="email-help">We send a code to this address to confirm you are an educator, and your puzzles go here too. Please use your school or organization address, not a personal one.</p>
<div class="grid2">
<label>School or organization *<input name="school" autocomplete="organization" maxlength="120" required></label>
<label>District (optional)<input name="district" maxlength="120" autocomplete="off"></label>
</div>
<label>Your role *<select name="role" required><option value="">Choose…</option>${o.roles.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
</fieldset>

<fieldset><legend>Your students</legend>
<label>Grade level *<select name="grade" required><option value="">Choose…</option>${o.grades.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>
<p class="help" id="grade-help" aria-live="polite">Choose a grade to see what suits it. The puzzles' difficulty, grid size, story length and print size follow the grade.</p>
</fieldset>

<fieldset><legend>Puzzles</legend>
<label>How many different puzzles? *<input name="count" type="number" min="1" max="${o.maxPuzzles}" value="5" required inputmode="numeric" aria-describedby="count-help"></label>
<p class="help" id="count-help">1 to <span id="max-puzzles">${o.maxPuzzles}</span>. Each one is a different puzzle with its own story.</p>
<fieldset class="choice"><legend>Difficulty</legend>
<label class="check"><input type="radio" name="difficulty" value="grade" checked> <span>Suited to the grade <span class="muted" id="diff-grade"></span></span></label>
<label class="check"><input type="radio" name="difficulty" value="progressive"> <span>Build up from easier to harder <span class="muted" id="diff-prog"></span></span></label>
<label class="check"><input type="radio" name="difficulty" value="level"> <span>One level for every puzzle:</span></label>
<label class="indent"><span class="sr-only">Level</span><select name="level" aria-label="Level">${o.difficulties.map((d) => `<option value="${d.id}">${esc(d.name)}: ${esc(d.summary)}</option>`).join('')}</select></label>
</fieldset>
<label>Grid size<select name="size"><option value="grade">Suited to the grade</option>${sizeOpts.join('')}</select></label>
<p class="help">Sizes that fit on one sheet of paper. Bigger grids take longer to solve.</p>
<label>Questions under each puzzle<select name="questions"><option value="">Suited to the grade</option>${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
<details><summary>Clue types (optional)</summary>
<p class="help">Leave all unticked to use the clues that suit each level. Ticking some limits the puzzles to those kinds of clue.</p>
<ul class="checks">${o.clueTypes.map((c) => `<li><label class="check"><input type="checkbox" name="clue" value="${c.id}"> <span>${esc(c.name)}</span></label></li>`).join('')}</ul>
</details>
</fieldset>

<fieldset><legend>Theme</legend>
<label class="check"><input type="radio" name="source" value="themes" checked> <span>Choose from our themes</span></label>
<label class="check"><input type="radio" name="source" value="custom"> <span>Create my own theme: my own story, characters and categories</span></label>
<div id="themes-panel">
<p class="help">Tick any themes and pick a topic for each, or tick none for a mix of all of them. Puzzles take turns through the themes you tick.</p>
<ul class="themes">${themeRows}</ul>
<label>Character names (optional)<textarea name="names" rows="2" maxlength="300" placeholder="Up to 8 names, for example your students' first names: Maya, Leo, Priya"></textarea></label>
</div>
<div id="custom-panel" hidden>
<p class="help">Write the puzzle's world yourself. We make the grid, the clues and the answer key from it, and check that each puzzle has exactly one answer.</p>
<label>Start from an example<select name="starter"><option value="">Blank</option>${o.starters.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select></label>
<div class="grid2">
<label>Theme name *<input name="c-theme" maxlength="60" autocomplete="off" placeholder="Science fair"></label>
<label>Puzzle title (optional)<input name="c-title" maxlength="80" autocomplete="off" placeholder="The Science Fair Mix-Up"></label>
</div>
<label>The story: set the scene (optional)<textarea name="c-story" rows="4" maxlength="1200" placeholder="It is science fair day, and the judges have mixed up their notes!"></textarea></label>
<div class="grid2">
<label>One character is a…<input name="c-one" maxlength="30" autocomplete="off" placeholder="student"></label>
<label>Several are…<input name="c-many" maxlength="30" autocomplete="off" placeholder="students"></label>
</div>
<label>Character names (optional, 3 to 8)<textarea name="c-names" rows="2" maxlength="300" placeholder="Maya, Leo, Priya, Sam, Ava"></textarea></label>
${[0, 1, 2, 3].map(catBlock).join('\n')}
<label>The ending, shown in the answer key (optional)<input name="c-ending" maxlength="300" autocomplete="off" placeholder="The judges thank everyone, and the fair goes on!"></label>
</div>
</fieldset>

<fieldset><legend>Printing</legend>
<div class="grid2">
<label>Paper<select name="paper">${Object.entries(o.papers).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
<label>Answer keys<select name="keys"><option value="separate">In a separate file, to keep back</option><option value="after">After each puzzle</option><option value="none">No answer keys</option></select></label>
</div>
<label class="check"><input type="checkbox" name="solutions"> <span>Add a worked solution, step by step, to each answer key</span></label>
<label class="check"><input type="checkbox" name="largePrint"> <span>Large print (bigger letters and grid squares)</span></label>
<label class="check"><input type="checkbox" name="nameLine" checked> <span>A name and date line on each puzzle</span></label>
<label>Package title (optional)<input name="title" maxlength="80" autocomplete="off" placeholder="Room 12: Logic Fridays"></label>
<label>Anything else we should know? (optional)<textarea name="note" rows="2" maxlength="500"></textarea></label>
</fieldset>

<label class="check agree"><input type="checkbox" name="agree" required> <span>I will use these puzzles with my own students and will not sell them or post them online. *</span></label>
<p><button class="btn big" type="submit" id="edu-send">Send my request</button></p>
<p class="help">We use your email only to confirm it and to send this package. See <a href="${up}privacy/">Privacy</a>.</p>
</form>

<section id="edu-verify" class="panel" hidden aria-labelledby="verify-h">
<h2 id="verify-h" tabindex="-1">Check your email</h2>
<p>We sent a 6-digit code to <strong id="verify-email"></strong>. It can take a few minutes to arrive; check your spam or junk folder too.</p>
<form id="verify-form" novalidate>
<label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required class="code"></label>
<p id="verify-error" class="errors" role="alert" hidden></p>
<p class="row"><button class="btn" type="submit">Confirm</button> <button class="btn ghost" type="button" id="verify-resend">Send a new code</button> <button class="btn ghost" type="button" id="verify-restart">Start over</button></p>
</form>
</section>

<section id="edu-done" class="panel" hidden aria-labelledby="done-h">
<h2 id="done-h" tabindex="-1">Thank you! Your request is with our team</h2>
<p>Your email is confirmed. We review requests by hand, usually within a day or two. Once approved, your puzzles are made and emailed to you as PDF files.</p>
<p class="muted">Request number <strong id="done-ref"></strong>. <span id="done-status"></span></p>
<p><a href="${up}fantastical/">Play a puzzle while you wait</a> · <a href="${up}printables/">This week's free worksheets</a></p>
</section>

<h2>Questions</h2>
<details><summary>Who can ask for a package?</summary><p>Teachers, teaching assistants, librarians, tutors, homeschool educators and school staff. We confirm each request with a code sent to a school or organization email address, and a person on our team approves it.</p></details>
<details><summary>Does it cost anything?</summary><p>No. Packages are free for classroom and home-school use.</p></details>
<details><summary>What grade levels does it suit?</summary><p>Kindergarten to Grade 12, college and adult learners. Younger grades get small grids, simple "is" and "is not" clues, a short story and large print; older students get bigger grids and harder clues such as "two years older than" and "if, then".</p></details>
<details><summary>Can I use my own theme or my students' names?</summary><p>Yes. Choose <strong>Create my own theme</strong> to write the story, the characters and up to four categories with their items, or type your students' first names under our themes. We check every puzzle has exactly one answer.</p></details>
<details><summary>How long does it take?</summary><p>The code arrives within minutes. A person reviews each request, usually within a day or two, and the PDFs are emailed within minutes of approval.</p></details>
<details><summary>Can I tell you how it went?</summary><p>Please do! The email with your puzzles has a private link to your own <strong>ideas, problems and feedback</strong> section, with a 2-minute survey about how our tools can help your class. A person on our team reads every note and emails you an answer.</p></details>
<details><summary>Can I share the puzzles?</summary><p>Print and copy them for your own students. Please don't sell them or post them online; send other teachers to this page instead.</p></details>`;
}

// Styles for the form, added to the page's inlined stylesheet.
export const EDUCATORS_CSS = `
.edu fieldset{border:1px solid var(--edge);border-radius:14px;padding:12px 18px 16px;margin:18px 0;background:var(--bg)}
.edu legend{font-weight:700;padding:0 6px;font-size:1.1rem}
.edu fieldset.choice,.edu fieldset.cat-block{background:transparent}
.edu label{display:block;margin:10px 0;font-weight:700}
.edu label.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}
.edu label.check input{margin-top:6px;width:20px;height:20px;flex:none}
.edu input:not([type=checkbox]):not([type=radio]),.edu select,.edu textarea{display:block;width:100%;margin-top:4px;padding:10px 12px;min-height:44px;font:inherit;color:var(--text);background:var(--page);border:1px solid var(--muted);border-radius:10px}
.edu input:focus-visible,.edu select:focus-visible,.edu textarea:focus-visible,.edu input[type=checkbox]:focus-visible,.edu input[type=radio]:focus-visible,.btn:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.edu .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
@media (max-width:640px){.edu .grid2{grid-template-columns:1fr}}
.edu .indent{margin-left:30px}
.help{font-size:.95rem;color:var(--muted);margin:4px 0 8px}
.themes,.checks{list-style:none;padding:0;margin:8px 0}
.theme-row{display:grid;grid-template-columns:1fr 220px;gap:4px 12px;align-items:center;border-top:1px solid var(--edge);padding:4px 0}
@media (max-width:640px){.theme-row{grid-template-columns:1fr}}
.theme-row label{margin:4px 0}
.checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.errors{color:#B3261E;font-weight:700}
@media (prefers-color-scheme:dark){.errors{color:#FF8A80}}
.errors ul{margin:6px 0}
.note,.panel{padding:16px 20px;background:var(--bg);border:2px solid var(--accent);border-radius:14px;margin:18px 0}
.code{font-size:1.6rem;letter-spacing:.3em;max-width:12ch}
.row{display:flex;flex-wrap:wrap;gap:10px}
.btn.ghost{background:transparent;color:var(--accent);border:2px solid var(--accent)}
button.btn{border:0;font:inherit;font-weight:700;cursor:pointer}
button.btn[disabled]{opacity:.6;cursor:progress}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.how li{margin:8px 0}
`;

// The private ideas, problems and feedback section (educators/feedback/),
// opened by the link in the email that carries an educator's PDFs. Not listed
// in search. The survey questions come from engine/src/classroom.js;
// seo/educator-feedback.js runs it against the game's Worker.
export function educatorFeedbackBody(up, { survey, kinds, textMax, api }) {
  const question = (q, i) => {
    const name = `q-${q.id}`;
    if (q.type === 'text') return `<label>${esc(q.q)}<textarea name="${name}" rows="4" maxlength="${q.max}"></textarea></label>`;
    const type = q.type === 'many' ? 'checkbox' : 'radio';
    return `<fieldset class="choice"><legend>${i + 1}. ${esc(q.q)}${q.required ? ' *' : ''}${q.type === 'many' ? ' <span class="muted">(choose any)</span>' : ''}</legend>
<ul class="checks">${q.options.map((o, j) => `<li><label class="check"><input type="${type}" name="${name}" value="${j}"> <span>${esc(o)}</span></label></li>`).join('')}</ul></fieldset>`;
  };
  return `<h1>Ideas, problems and feedback</h1>
<div id="fb-app" class="edu" data-api="${esc(api || '')}">
<section id="fb-locked" class="panel" aria-labelledby="locked-h">
<h2 id="locked-h">This section is for educators who received a puzzle package</h2>
<p id="fb-locked-why">It opens with the private link in the email that brought your puzzles. Please use the <strong>Share ideas and feedback</strong> button in that email.</p>
<p>No package yet? <a href="${up}educators/">Ask for a free puzzle package</a>. Questions? Write to <a href="mailto:support@thelogicgrid.com">support@thelogicgrid.com</a>.</p>
</section>

<div id="fb-open" hidden>
<p class="lede" id="fb-hello"></p>
<p>Thank you for using our puzzles with your students. Tell us how it went: a person on our team reads every note, and your answers help us decide what to build next for classrooms. We only use them to improve our tools.</p>

<section class="panel" aria-labelledby="survey-h">
<h2 id="survey-h" tabindex="-1">A 2-minute survey</h2>
<p class="muted" id="survey-state">Questions marked * are needed. You can change your answers later.</p>
<form id="survey-form" novalidate>
${survey.map(question).join('\n')}
<div id="survey-errors" class="errors" role="alert" tabindex="-1" hidden></div>
<p><button class="btn" type="submit" id="survey-send">Send my answers</button> <span id="survey-done" class="ok" role="status"></span></p>
</form>
</section>

<section class="panel" aria-labelledby="note-h">
<h2 id="note-h">Send an idea, a problem or feedback</h2>
<form id="note-form" novalidate>
<fieldset class="choice"><legend>What is it?</legend>
<div class="row">${Object.entries(kinds).map(([k, w], i) => `<label class="check"><input type="radio" name="kind" value="${k}"${i === 0 ? ' checked' : ''}> <span>${esc(w)}</span></label>`).join('')}</div></fieldset>
<label>Your note<textarea name="text" rows="5" maxlength="${textMax}" required placeholder="For example: a theme your class would love, something that did not print well, or how your students got on."></textarea></label>
<div id="note-errors" class="errors" role="alert" hidden></div>
<p><button class="btn" type="submit" id="note-send">Send</button> <span id="note-done" class="ok" role="status"></span></p>
</form>
</section>

<section aria-labelledby="mine-h">
<h2 id="mine-h">Your notes and our answers</h2>
<div id="fb-items"><p class="muted">Nothing sent yet.</p></div>
</section>
</div>
</div>`;
}

export const FEEDBACK_CSS = `
.ok{color:#1B6B2F;font-weight:700}
@media (prefers-color-scheme:dark){.ok{color:#8BD99B}}
.fb-item{border-top:1px solid var(--edge);padding:10px 0}
.fb-item blockquote{margin:6px 0;padding:8px 14px;border-left:4px solid var(--accent);background:var(--bg);border-radius:6px}
.fb-item .kind{font-weight:700}
`;
