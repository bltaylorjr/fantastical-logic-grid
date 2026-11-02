// The game screen: the shared kit (modules/grid-kit/kit.js) with this game's definition (game.js).
// The host mounts it the same way as NINETIMESNINE (see modules/README.md).
import { createGame } from '../grid-kit/kit.js';
import { def } from './game.js';

export const { mount, unmount, suspend, reopen, setShared, state, learning, dailyOptions } = createGame(def);
