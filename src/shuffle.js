/**
 * Draws a uniformly random sample without replacement (partial Fisher-Yates),
 * so every ordering of the result is equally likely.
 * @param {!Array<string>} uris The track URIs to sample from; not mutated.
 * @param {number} count The maximum number of tracks to return.
 * @return {!Array<string>}
 */
export function shuffledBatch(uris, count) {
    if (!Number.isInteger(count) || count < 0) {
        throw new RangeError("Shuffle count must be a non-negative integer.");
    }
    const pool = uris.slice();
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i += 1) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}
