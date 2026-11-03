// The website's other pages (the front page, NINETIMESNINE and the other
// games, the account page, the puzzle wizard, how to play, daily, printables,
// educators and the rest) count visits the same way the Fantastical game does:
//  - a visit from a campaign link, for the admin Marketing page (campaign.js)
//  - the once-a-day visit for the admin Visitors page (visit.js); one device is
//    still counted once a day however many pages it opens.
import { init } from './campaign.js';
import { countVisit, signedInHere } from './visit.js';

init();
countVisit(signedInHere());
