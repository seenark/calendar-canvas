import { atom } from "jotai/vanilla";

/** Set when the server answers 401 to a batch of Ops. Flushing stays paused until the User signs in again. */
export const needsAuthAtom = atom(false);
