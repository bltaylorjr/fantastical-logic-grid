// More topics and story parts, one file per theme (more-topics-<theme>.js),
// added in the October 2026 content upgrade: every plausible topic for each
// theme, and at least 10 storylines (incidents) and 10 openings per topic.
// topics.js appends them after its own lists, so existing topics and story
// parts keep their places (saved story ids point at them).
//
// Each file exports { topics: [...], stories: { 'theme' | 'theme/topic': { openings, incidents, ... } } }.
// Same rules as topics.js: a new topic brings its own complete story; no story
// part may name a grid item or a cast name (the engine tests check).
import { MORE as mystery } from './more-topics-mystery.js';
import { MORE as action } from './more-topics-action.js';
import { MORE as adventure } from './more-topics-adventure.js';
import { MORE as holiday } from './more-topics-holiday.js';
import { MORE as occasion } from './more-topics-occasion.js';
import { MORE as fantasy } from './more-topics-fantasy.js';
import { MORE as scifi } from './more-topics-scifi.js';
import { MORE as sports } from './more-topics-sports.js';
import { MORE as cooking } from './more-topics-cooking.js';
import { MORE as pets } from './more-topics-pets.js';
import { MORE as town } from './more-topics-town.js';
import { MORE as parks } from './more-topics-parks.js';
import { MORE as travel } from './more-topics-travel.js';
import { MORE as wonders } from './more-topics-wonders.js';
import { MORE as music } from './more-topics-music.js';
import { MORE as nautical } from './more-topics-nautical.js';
import { MORE as farm } from './more-topics-farm.js';
import { MORE as science } from './more-topics-science.js';
import { MORE as math } from './more-topics-math.js';
import { MORE as biology } from './more-topics-biology.js';
import { MORE as astronomy } from './more-topics-astronomy.js';
import { MORE as paradox } from './more-topics-paradox.js';
import { MORE as seasons } from './more-topics-seasons.js';

export const MORE_TOPICS = { mystery, action, adventure, holiday, occasion, fantasy, scifi, sports, cooking, pets, town, parks, travel, wonders, music, nautical, farm, science, math, biology, astronomy, paradox, seasons };
