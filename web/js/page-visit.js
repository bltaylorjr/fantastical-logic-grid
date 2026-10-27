// The website's own pages (how to play, daily, printables, educators and the
// rest, built by scripts/seo.mjs) count a visit from a campaign link the same
// way the game does, so ads that open one of them are tracked too.
import { init } from './campaign.js';

init();
