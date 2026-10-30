// Player Stories: hand-written story puzzles sent in through the game's
// Ideas box (topic "Storyline idea"). Each one keeps the writer's own scene,
// cast, categories and items exactly, so the puzzle is theirs; the engine only
// writes the clues and checks there is one solution.
//
// Each story is an educator-style custom world (classroom.js checkCustom shape)
// plus:
//   id          - stable id, used as the topic id under the "stories" theme
//   difficulty  - the tier the writer chose; the story always plays at it
//   look        - an existing theme id for colors, pictures and music
//   interests   - the writer's interest categories, shown on the setup screen
//   submitted   - when the idea arrived (UTC date)
//
// Edit with care: the story text, names and items are the writer's words.
// Only fix clear typos, and never reorder an ordered list.

const place = (count) => ({
  name: 'Place', items: ['1st', '2nd', '3rd', '4th', '5th', '6th'].slice(0, count),
  pos: 'placed', neg: 'did not place', order: 'earlier', less: 'placed ahead of', more: 'placed behind',
});
const photographer = { one: 'photographer', many: 'photographers' };
const photo = (items) => ({ name: 'Photo', items, pos: 'took the photo titled', neg: 'did not take the photo titled' });
const seniorContest = 'The results of the annual senior photography contest are in! The judges selected five winning photographs, each with a distinct vision of the season.';

export const PLAYER_STORIES = [
  {
    id: 'capturing-spring', difficulty: 'easy', look: 'town', submitted: '2026-10-27',
    interests: ['Hobbies', 'Spring', 'Around Town', 'Country'],
    def: {
      theme: 'Spring photography contest', title: 'Capturing Spring', story: seniorContest,
      cast: photographer, names: ['Olga', 'Eugene', 'Oscar', 'Nettie', 'Beatrix'],
      categories: [photo(['Children in Pastels', 'Duck Pond', 'Early Blossoms', 'Puppies', 'Spring Sport']), place(5)],
    },
  },
  {
    id: 'capturing-summer', difficulty: 'easy', look: 'town', submitted: '2026-10-27',
    interests: ['Hobbies', 'Seasonal', 'Summer'],
    def: {
      theme: 'Summer photography contest', title: 'Capturing Summer', story: seniorContest,
      cast: photographer, names: ['Olga', 'Jean', 'Otto', 'Ruth', 'Bertram'],
      categories: [photo(['By the Pool', 'Sunflowers', 'Siesta', 'Block Party', 'At the Park']), place(5)],
    },
  },
  {
    id: 'capturing-fall', difficulty: 'easy', look: 'town', submitted: '2026-10-27',
    interests: ['Hobbies', 'Fall', 'Around Town', 'Country'],
    def: {
      theme: 'Fall photography contest', title: 'Capturing Fall', story: seniorContest,
      cast: photographer, names: ['Olga', 'Eugene', 'Oscar', 'Nettie', 'Beatrix'],
      categories: [photo(['Apple Tree', 'Scarecrow', 'Tiny Pumpkins', 'Falling Leaves', 'Fall Hike']), place(5)],
    },
  },
  {
    id: 'capturing-winter', difficulty: 'medium', look: 'town', submitted: '2026-10-27',
    interests: ['Hobbies', 'Winter', 'Around Town', 'Seasonal'],
    def: {
      theme: 'Winter photography contest', title: 'Capturing Winter',
      story: 'The results from Coletown\'s winter photography contest are in! To win, photographers were required to submit images from local businesses in Coletown. The seniors division had the most beautiful images, so the judges selected five winning photographs. Each photograph captured a different business, decorated with a distinct winter theme.',
      cast: photographer, names: ['Oscar', 'Wilfred', 'Flossie', 'Mabel', 'Bernice'],
      categories: [
        { name: 'Business', items: ['Red\'s Tool Shed', 'Bob\'s Diner', 'Birkenshelf\'s Antiques', 'Florshum Florist', 'Sheffman Jewelers'], pos: 'photographed', neg: 'did not photograph' },
        { name: 'Theme', items: ['Snow Scene', 'Gifts Galore', 'Bright Lights', 'Red Ribbons', 'Silver & Gold'], pos: 'captured the theme', neg: 'did not capture the theme' },
        place(5),
      ],
    },
  },
  {
    id: 'spring-storefront', difficulty: 'hard', look: 'town', submitted: '2026-10-27',
    interests: ['Hobbies', 'Spring', 'Easter', 'Around Town', 'Seasonal'],
    def: {
      theme: 'Spring storefront contest', title: 'Spring Storefront Contest',
      story: 'The results from Coletown\'s window decorating contest are in! Shopkeepers from local businesses decorated their shop windows with spring and Easter decor. Each business used a pastel color theme as well. The judges, overwhelmed with beautiful entries, selected six winning storefronts.',
      cast: { one: 'shopkeeper', many: 'shopkeepers' }, names: ['Virgil', 'Hamlin', 'Gertie', 'Otto', 'Wilhma', 'Bernie'],
      categories: [
        { name: 'Business', items: ['Red\'s Tool Shed', 'Bob\'s Diner', 'Birkenshelf\'s Antiques', 'Florshum Florist', 'Sheffman Jewelers', 'Chief Automotive'], pos: 'runs', neg: 'does not run' },
        { name: 'Decoration', items: ['Bunny', 'Chick', 'Lamb', 'Easter Egg', 'Cross', 'Church'], pos: 'decorated with the', neg: 'did not decorate with the' },
        { name: 'Color', items: ['Lavender', 'Yellow', 'Apricot', 'Chartreuse', 'Pale Pink', 'Baby Blue'], pos: 'used the color', neg: 'did not use the color' },
        place(6),
      ],
    },
  },
  {
    id: 'couples-orchard', difficulty: 'medium', look: 'farm', submitted: '2026-10-27',
    interests: ['Romance', 'Destinations', 'Fall'],
    def: {
      theme: 'Couples\' hour at the orchard', title: 'Couples\' Hour at the Orchard',
      story: 'Five couples came to Overlook Orchard on Sunday to unwind in the early autumn breeze. Each couple sampled a variety of apples, inevitably purchasing one variety. As they toured the orchard, grazed and shopped, each couple departed at a different time with their apples and gift shop items as the afternoon slipped away.',
      cast: { one: 'couple', many: 'couples' }, names: ['Adrian & Amber', 'Taylor & Travis', 'Nate & Nicole', 'Mitch & Michelle', 'Bertram & Belle'],
      categories: [
        { name: 'Apple', items: ['McIntosh', 'Golden Delicious', 'Pink Lady', 'Ludacrisp', 'Fuji'], pos: 'bought', neg: 'did not buy' },
        { name: 'Gift', items: ['Apple Corer', 'Paring Knife', 'Recipe Cards', 'Framed Photo', 'Tablecloth'], pos: 'bought the', neg: 'did not buy the' },
        { name: 'Departure', items: ['2:20 PM', '2:30 PM', '3:00 PM', '3:20 PM', '3:30 PM'], pos: 'left at', neg: 'did not leave at', order: 'earlier', less: 'left earlier than', more: 'left later than' },
      ],
    },
  },
  {
    id: 'late-spring-vineyards', difficulty: 'medium', look: 'travel', submitted: '2026-10-27',
    interests: ['Travel', 'Romance', 'Food & Wine', 'Destinations', 'Spring'],
    def: {
      theme: 'Vineyard tasting', title: 'Late Spring Vineyards',
      story: 'Five couples took an excursion to Late Spring Vineyards to enjoy the initial warm weather. Each couple chose to book a different food and wine pairing. As they toured the vineyard gardens, each couple visited the counter at their scheduled times throughout the afternoon.',
      cast: { one: 'couple', many: 'couples' }, names: ['House', 'Kennedy', 'Sanchez', 'Torres', 'Walters'],
      categories: [
        { name: 'Wine', items: ['Clean Whites', 'Floral Notes', 'Fruity Picks', 'Springtime Soiree', 'Vintage Mix'], pos: 'tasted', neg: 'did not taste' },
        { name: 'Pairing', items: ['Aged Meats', 'Almonds', 'Cheese', 'Crostini', 'Olives'], pos: 'snacked on', neg: 'did not snack on' },
      ],
    },
  },
];

export const getPlayerStory = (id) => PLAYER_STORIES.find((s) => s.id === id) || null;

const SIZE_WORDS = (s) => `${s.def.categories.length + 1} lists of ${s.def.names.length}`;

// The setup screen's entry: a theme whose topics are the stories ("any" picks one).
export const PLAYER_STORIES_THEME = {
  id: 'stories', name: 'Player Stories', description: 'Puzzles written by players, with their own scene, cast and lists.',
  defaultTopic: 'any',
  topics: [{ id: 'any', name: 'Any', description: 'A surprise player-written story each time.' },
    ...PLAYER_STORIES.map((s) => ({ id: s.id, name: s.def.title, description: `${s.difficulty[0].toUpperCase()}${s.difficulty.slice(1)} · ${SIZE_WORDS(s)} · ${s.interests.join(', ')}` }))],
};
