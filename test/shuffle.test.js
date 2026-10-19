import { test, expect } from "vitest";
import { shuffledBatch } from "../src/shuffle.js";

test("returns every track, permuted, when playlist is smaller than the cutoff", () => {
    const uris = ["a", "b", "c", "d"];
    const batch = shuffledBatch(uris, 100);
    expect(batch.length).toBe(uris.length);
    expect([...batch].sort()).toEqual([...uris].sort());
});

test("returns exactly count unique tracks when playlist is larger than the cutoff", () => {
    const largePlaylist = Array.from({ length: 500 }, (_, i) => `track-${i}`);
    const largeBatch = shuffledBatch(largePlaylist, 100);
    expect(largeBatch.length).toBe(100);
    expect(new Set(largeBatch).size).toBe(100);
});

test("keeps both entries when the playlist lists the same track twice", () => {
    const batch = shuffledBatch(["a", "a", "b"], 3);
    expect(batch.length).toBe(3);
    expect([...batch].sort()).toEqual(["a", "a", "b"]);
});

test("does not mutate the input array", () => {
    const uris = ["a", "b", "c", "d"];
    const copy = [...uris];
    shuffledBatch(uris, 2);
    expect(uris).toEqual(copy);
});

test("returns an empty array for zero count or empty input", () => {
    expect(shuffledBatch(["a", "b", "c"], 0)).toEqual([]);
    expect(shuffledBatch([], 5)).toEqual([]);
});

test("rejects an invalid count", () => {
    for (const count of [-1, 1.5, Number.NaN]) {
        const fn = () => shuffledBatch(["a"], count);
        expect(fn).toThrow(RangeError);
        expect(fn).toThrow(/non-negative integer/);
    }
});
