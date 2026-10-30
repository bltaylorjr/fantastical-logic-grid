import sys
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, ListFlowable, ListItem
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch

INK = colors.HexColor('#1F2A44'); MUTED = colors.HexColor('#5B6475'); ACCENT = colors.HexColor('#7A3E9D')
FILL = colors.HexColor('#F4F6FA'); LINE = colors.HexColor('#C9D0DC'); GOOD = colors.HexColor('#E5F4E4'); BAD = colors.HexColor('#FBEBEB')
ss = getSampleStyleSheet()
body = ParagraphStyle('b', parent=ss['Normal'], fontName='Helvetica', fontSize=10.5, leading=14.5, textColor=INK, spaceAfter=6)
small = ParagraphStyle('s', parent=body, fontSize=9, leading=12, textColor=MUTED)
cell = ParagraphStyle('c', parent=body, fontSize=9.2, leading=12, spaceAfter=0)
cellb = ParagraphStyle('cb', parent=cell, fontName='Helvetica-Bold')
h1 = ParagraphStyle('h1', parent=body, fontName='Helvetica-Bold', fontSize=18, leading=22, textColor=ACCENT, spaceBefore=6, spaceAfter=8)
h2 = ParagraphStyle('h2', parent=body, fontName='Helvetica-Bold', fontSize=12.5, leading=16, textColor=INK, spaceBefore=10, spaceAfter=4)
kicker = ParagraphStyle('k', parent=body, fontName='Helvetica-Bold', fontSize=8.5, textColor=ACCENT)
title = ParagraphStyle('t', parent=body, fontName='Helvetica-Bold', fontSize=28, leading=33, spaceAfter=10)
code = ParagraphStyle('code', parent=body, fontName='Courier', fontSize=9, leading=12, backColor=FILL, borderPadding=6, spaceBefore=4, spaceAfter=10)

P = lambda t, s=body: Paragraph(t, s)
def bullets(items, numbered=False):
    return ListFlowable([ListItem(P(t), leftIndent=14, value=None) for t in items], bulletType='1' if numbered else 'bullet', start=None if not numbered else 1, leftIndent=14, bulletFontSize=9 if not numbered else 10, bulletColor=ACCENT)
def table(rows, widths, head=True, fills=None):
    data = [[P(c, cellb if (head and r == 0) else cell) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    st = [('GRID', (0, 0), (-1, -1), 0.5, LINE), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]
    if head: st += [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E8ECF3'))]
    for (r, c) in (fills or []): st.append(('BACKGROUND', (c, r), (c, r), fills[(r, c)]))
    t.setStyle(TableStyle(st)); return t

W = 6.5 * inch
s = []
s += [P('THE FANTASTICAL LOGIC GRID', kicker), P('Author Packet', title),
      P('Everything you need to write a story topic for the game and get it into the game: the writing rules, worked examples, and a step-by-step guide to uploading your story to the repository.'),
      Spacer(1, 6),
      table([['What', 'File', 'Use it for'],
             ['Writing Guide and Upload Guide', 'This PDF', 'The rules, examples, and how to submit'],
             ['Submission Form', 'Story-Submission-Form.docx', 'Drafting in Word, offline'],
             ['Standard submission file', 'authors/submissions/TEMPLATE.md', 'What you actually upload'],
             ['Checker', 'scripts/check-story-submission.mjs', 'Runs by itself on every upload']],
            [1.9 * inch, 2.3 * inch, 2.3 * inch]),
      Spacer(1, 10),
      P('<b>The one rule above all others:</b> write every story part yourself, in your own words. That is what makes the stories yours under copyright. Facts belong to no one; your wording, your choice of events and how you arrange them are what you own.'),
      ]

s += [P('1. How a story is built', h1),
      P('The game assembles each story from one of each part below, chosen fresh every time. Six openings, six incidents, four mix-ups, four endings, six title words and two leads per category already make thousands of different stories, and the game never gives a player one they have already seen.'),
      table([['Part', 'What it does', 'Fill-ins you can use', 'Example'],
             ['Title word', 'The title reads "The &lt;word&gt; &lt;incident name&gt;"', 'none', 'Frosty, Golden, Midnight'],
             ['Opening', 'Sets the scene and says how many people', '{n} or {N}, {many}', '{N} {many} met at the corner, bundled up to their noses.'],
             ['Incident', 'What is at stake: a name, a sentence and a prize', 'none', 'Fort | A snow fort went up behind the library. | the fort award'],
             ['Mix-up', 'Why the facts got scrambled', 'none', 'The wind blew everyone\'s notes into the drifts.'],
             ['Lead', 'Ties the answer to one category', '{x}, {one}, {prize}', 'A mug of {x} cocoa sat steaming.'],
             ['Ending', 'The reward shown when the puzzle is solved', '{Fact}, {winner}, {prize}', '{Fact}, so {winner} is the one behind {prize}!']],
            [0.95 * inch, 1.85 * inch, 1.2 * inch, 2.5 * inch]),
      KeepTogether([P('What the fill-ins become', h2),
      table([['Fill-in', 'Becomes', 'Example'],
             ['{n} / {N}', 'How many people (lowercase / capitalized)', 'four / Four'],
             ['{many} / {one}', 'Your cast word, plural / single', 'neighbors / neighbor'],
             ['{x}', 'The answer item for this puzzle', 'Mint'],
             ['{Fact}', 'The full answer sentence', 'Nora drank Mint cocoa'],
             ['{winner}', 'The answer person', 'Nora'],
             ['{prize}', 'The incident\'s prize', 'the fort award']],
            [1.2 * inch, 3.0 * inch, 2.3 * inch])]),
      ]

s += [P('2. The rules (the checker tests each one)', h1),
      bullets(['<b>Never name a category item or a cast name in any story part.</b> If "Oak" is a street on the grid, an opening that says "Oak Street" reads like a clue.',
               'Never use another topic\'s cast word in the same theme (no "sailors" in a railroad story).',
               'Openings must use {n} or {N} and {many}. Leads must use {x}. Endings must use {Fact}.',
               'Keep parts to about 10 to 25 words. A whole story must stay under 150 words.',
               'At least 5 categories, at least one numbered (a time or a number). Plain categories need exactly 8 items. Every item and cast name is used once only.',
               'Compare numbers with words like earlier/later or more/fewer, not higher/lower or above/below.',
               'Never write how many people there are as a number. Use {n}, so the story always matches the grid.',
               'Friendly for all ages: no violence words, no links, no code.']),
      P('Good and not so good', h2),
      table([['Not so good', 'Better', 'Why'],
             ['Four neighbors woke up to snow.', '{N} {many} woke up to snow.', 'The head count changes with grid size; {N} always matches.'],
             ['{N} {many} met on Oak Street.', '{N} {many} met at the corner.', '"Oak" is a Street item, so it gives away a clue.'],
             ['A shovel leaned by the door.', 'A {x} shovel leaned by the door.', 'A lead must contain {x}, the answer item.'],
             ['Nora won the award!', '{Fact}, so {winner} won {prize}!', 'Real names change every puzzle; fill-ins keep it right.'],
             ['had a higher score than', 'scored more points than', 'Higher/lower needs a note on which way the numbers run.']],
            [2.0 * inch, 2.15 * inch, 2.35 * inch],
            fills={(r, 0): BAD for r in range(1, 6)} | {(r, 1): GOOD for r in range(1, 6)}),
      KeepTogether([P('Writing tips', h2),
      bullets(['Write the way you talk. Short sentences read best aloud, and the game reads stories aloud.',
               'Each opening should feel like a different moment: dawn, a storm, the night before, the last minute.',
               'Give incidents real stakes, and give each prize a "the": the lantern rescue, the fort award.',
               'Mix-ups are a chance for humor: a sneeze, a spilled drink, notes in a snowdrift.',
               'Read one finished story aloud. If you stumble, shorten it.'])]),
      ]

s += [P('3. True stories (history topics)', h1),
      P('A history topic puts the player in a situation like a real event, with an invented cast. On solve, a Fact card shows what really happened.'),
      bullets(['<b>Real names, dates and places go only on the Fact card</b>, never in story parts. The cast is always invented.',
               'Build the Fact card from at least one trustworthy source you actually read (a museum, a national park, NASA, an encyclopedia), plus a second source that agrees.',
               'Write the Fact card in your own words: 2 to 4 plain sentences. Don\'t copy sentences from the source.',
               'Leave out famous quotes and song lyrics. Quotes can belong to someone; facts never do.',
               'When sources disagree on a detail (an exact day or count), keep it general: "December 1913".',
               'Turn facts into parts: a real moment becomes an incident, a real setting becomes an opening, a real confusion becomes a mix-up, and the jobs, tools and places of the time become category items.']),
      P('4. Authorship and your records', h1),
      bullets(['Write every part yourself. If you started from an AI draft, rewrite it fully, and say which parts on the form. Light edits to AI text don\'t make it yours.',
               'Upload from your own GitHub account. Each upload is a dated record of what you wrote.',
               'Keep your drafts. Your Word form and earlier versions show the work was yours.',
               'If you register a copyright, say which parts (if any) came from AI and leave them out of the claim.']),
      P('This packet is general guidance, not legal advice.', small),
      ]

s += [PageBreak(), P('5. Upload guide: step by step', h1),
      P('All you need is a web browser and a free GitHub account. It takes about ten minutes the first time.'),
      table([['Step', 'What to do'],
             ['1. Get the form', 'On GitHub, open <b>authors/submissions/TEMPLATE.md</b>. Click <b>Download raw file</b> (the download arrow at the top right of the file) and save it.'],
             ['2. Name it', 'Rename your copy to your topic id, for example <b>snow-day.md</b>: lowercase letters, numbers and dashes only.'],
             ['3. Fill it in', 'Open it in a plain text editor (Notepad, TextEdit in plain text mode, or VS Code). Type after each colon or dash. Leave lines that start with &gt; alone. Drafted in Word? Copy each answer into the matching line.'],
             ['4. Upload', 'In the repository, open <b>authors</b>, then <b>submissions</b>. Click <b>Add file</b>, then <b>Upload files</b>, and drag your file in.'],
             ['5. Describe it', 'Under <b>Commit changes</b>, write a short message: <b>Add story submission: snow-day</b>.'],
             ['6. New branch', 'Choose <b>Create a new branch for this commit and start a pull request</b>. Click <b>Propose changes</b>, then <b>Create pull request</b>.'],
             ['7. Read the check', 'Within a minute the pull request shows <b>Story submission check</b>. Green check: ready. Red X: click <b>Details</b> to see each item marked FIX, in plain English.'],
             ['8. Fix it', 'In the pull request, open <b>Files changed</b>, click the <b>...</b> menu on your file, choose <b>Edit file</b>, fix it, and commit to the same branch. The check runs again.'],
             ['9. Add to the game', 'When the check is green, comment on the pull request (or ask Claude) to add the topic. Your story text goes in exactly as you wrote it.']],
            [1.35 * inch, 5.15 * inch]),
      P('Check it yourself first (optional)', h2),
      P('With Node.js installed, from the repository folder:'),
      P('node scripts/check-story-submission.mjs authors/submissions/snow-day.md', code),
      P('FIX lines must be fixed. CHECK lines are worth a second look but don\'t block. A passing file prints a sample story built from your parts and how many different storylines it can tell.'),
      ]

s += [KeepTogether([P('Common check messages', h2),
      table([['The check says', 'What to do'],
             ['names the Street item "Oak"', 'Reword that part so it doesn\'t mention any grid item.'],
             ['the lead ... must contain {x}', 'Add {x} where the answer item belongs.'],
             ['Openings ... use {n} or {N} ... and {many}', 'Add the head count and cast word fill-ins.'],
             ['needs exactly 8 items', 'Plain categories need 8 items, separated by commas.'],
             ['is both a ... item and a cast name', 'Rename one; every item and name must be different.'],
             ['answer "yes" to "I wrote every story part"', 'Confirm you wrote it, or rewrite the parts first.'],
             ['Some stories run to 150 words', 'Shorten the longest openings, incidents and mix-ups.'],
             ['looks like a real name (CHECK)', 'History topics: move real people to the Fact card.']],
            [2.9 * inch, 3.6 * inch])]),
      Spacer(1, 10),
      P('Before you upload', h2),
      bullets(['No story part names an item or a cast name.', 'Every lead has {x}; every opening has {n} or {N} and {many}; every ending has {Fact}.',
               'Each item and cast name is used once only.', 'History: every Fact card detail matches a source you read.',
               'The file is named your-topic-id.md and saved as plain text.']),
      ]

def page(c, d):
    c.saveState(); c.setFont('Helvetica', 8); c.setFillColor(MUTED)
    c.drawCentredString(letter[0] / 2, 0.55 * inch, f'The Fantastical Logic Grid  ·  Author Packet  ·  page {d.page}')
    c.restoreState()
doc = SimpleDocTemplate(sys.argv[1], pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=0.8 * inch, bottomMargin=0.85 * inch,
                        title='Author Packet: Writing Guide and Upload Guide', author='The Fantastical Logic Grid')
doc.build(s, onFirstPage=page, onLaterPages=page)
print('ok')
