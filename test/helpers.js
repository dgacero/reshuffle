/**
 * Builds an in-memory `Storage` stand-in (`localStorage`/`sessionStorage`) for
 * tests.
 * @param {!Array<!Array<string>>=} entries Initial `[key, value]` pairs.
 * @return {{getItem: function(string): ?string,
 *     setItem: function(string, *): void,
 *     removeItem: function(string): void}} A Storage-like object.
 */
export function fakeStorage(entries = []) {
    const store = new Map(entries);
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
    };
}
