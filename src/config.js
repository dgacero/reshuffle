/** The public Spotify application client ID used for PKCE authorization. */
export const CLIENT_ID = "7f6ceeedc16d41288c419aba5ada390e";

/**
 * Builds the OAuth redirect URI from the current page location.
 * @return {string}
 */
export function redirectUri() {
    return location.origin + location.pathname;
}

/** The Spotify permissions requested during login. */
export const SCOPES = [
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "user-read-playback-state",
    "user-modify-playback-state",
].join(" ");

/** The default number of tracks queued by each shuffle. */
export const DEFAULT_BATCH_SIZE = 100;
const BATCH_SIZE_KEY = "reshuffle:batchSize";

/**
 * Returns how many songs each shuffle queues. Users always get
 * `DEFAULT_BATCH_SIZE`; a developer can override via `setBatchSize()` (exposed
 * as `devBatchSize()` on `window`). Any positive integer is honored.
 * @return {number} The stored positive-integer batch size, or the default.
 */
export function getBatchSize() {
    const stored = Number(localStorage.getItem(BATCH_SIZE_KEY));
    return Number.isInteger(stored) && stored > 0 ? stored : DEFAULT_BATCH_SIZE;
}

/**
 * Persists a developer batch-size override.
 * @param {number} size The number of songs to queue per shuffle.
 */
export function setBatchSize(size) {
    if (!Number.isInteger(size) || size <= 0) {
        throw new RangeError("Batch size must be a positive integer.");
    }
    localStorage.setItem(BATCH_SIZE_KEY, String(size));
}
