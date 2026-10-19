import { test, expect } from "vitest";
import { fakeStorage } from "./helpers.js";
import { play } from "../src/player.js";

function stubFetch(t, responses) {
    const calls = [];
    global.localStorage = fakeStorage([
        ["access_token", "token"],
        ["refresh_token", "refresh"],
        ["expires_at", String(Date.now() + 60_000)],
    ]);
    global.fetch = async (url, opts = {}) => {
        calls.push({ url, opts });
        return responses.shift();
    };
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.fetch;
    });
    return calls;
}

function jsonPage(body) {
    return { ok: true, status: 200, json: async () => body };
}

function noContent() {
    return { ok: true, status: 204 };
}

function captureStatus() {
    const messages = [];
    return { setStatus: (text) => messages.push(text), messages };
}

function trackItem(uri) {
    return { track: { uri, is_local: false, type: "track" } };
}

function playlistTrackItem(uri) {
    return { item: { uri, is_local: false, type: "track" } };
}

test("play rejects an invalid source without making requests", async (t) => {
    const calls = stubFetch(t, []);
    await expect(() => play({ type: "unknown" }, () => {})).rejects.toThrow(/valid playlist or Liked Songs source/);
    await expect(() => play({ type: "playlist" }, () => {})).rejects.toThrow(/valid playlist or Liked Songs source/);
    await expect(() => play(null, () => {})).rejects.toThrow(/valid playlist or Liked Songs source/);
    expect(calls.length).toBe(0);
});

test("play clears status and stops before loading tracks without an active device", async (t) => {
    const calls = stubFetch(t, [jsonPage({ is_playing: false, device: { id: "phone" } })]);
    const { setStatus, messages } = captureStatus();

    const result = await play({ type: "liked" }, setStatus);

    expect(result).toBeUndefined();
    expect(messages).toEqual([""]);
    expect(calls.length, "playback-only request must stop before loading the library").toBe(1);
});

test("play reports nothing playable when the source has no playable tracks", async (t) => {
    const calls = stubFetch(t, [
        jsonPage({ is_playing: true, device: { id: "phone" } }),
        jsonPage({ items: [], next: null, total: 0 }),
    ]);
    const { setStatus, messages } = captureStatus();

    const result = await play({ type: "liked" }, setStatus);

    expect(result).toBeUndefined();
    expect(messages.at(-1)).toBe("Nothing playable to shuffle here.");
    expect(calls.length, "should not queue anything").toBe(2);
});

test("play propagates a failure on the first queue request", async (t) => {
    const calls = stubFetch(t, [
        jsonPage({ is_playing: true, device: { id: "phone" } }),
        jsonPage({ items: [trackItem("spotify:track:a"), trackItem("spotify:track:b")], next: null, total: 2 }),
        { ok: false, status: 500 },
    ]);
    const { setStatus, messages } = captureStatus();

    await expect(() => play({ type: "liked" }, setStatus)).rejects.toThrow(/Something went wrong.*500/);

    expect(calls.length).toBe(3);
    expect(messages).toEqual(["Loading library…", "Loading library… 2/2"]);
});

test("play queues a shuffled batch from Liked Songs to the active device", async (t) => {
    const calls = stubFetch(t, [
        jsonPage({ is_playing: true, device: { id: "phone" } }),
        jsonPage({
            items: [trackItem("spotify:track:a"), trackItem("spotify:track:b"), trackItem("spotify:track:c")],
            next: null,
            total: 3,
        }),
        noContent(),
        noContent(),
        noContent(),
    ]);
    const { setStatus, messages } = captureStatus();

    const result = await play({ type: "liked" }, setStatus);

    expect(result).toBe(3);
    expect(calls.length, "1 playback check + 1 library page + 3 queue calls").toBe(5);

    const queueCalls = calls.slice(2);
    for (const call of queueCalls) {
        expect(call.opts.method).toBe("POST");
        expect(call.url).toMatch(/device_id=phone$/);
    }
    const queuedUris = queueCalls.map((c) => new URL(c.url).searchParams.get("uri"));
    expect([...queuedUris].sort()).toEqual(["spotify:track:a", "spotify:track:b", "spotify:track:c"]);

    expect(messages).toEqual(["Loading library…", "Loading library… 3/3", "Queued 1/3…", "Queued 2/3…", "Queued 3/3…"]);
});

test("play queues a shuffled batch from a chosen playlist", async (t) => {
    const calls = stubFetch(t, [
        jsonPage({ is_playing: true, device: { id: "phone" } }),
        jsonPage({ items: [playlistTrackItem("spotify:track:x")], next: null, total: 1 }),
        noContent(),
    ]);
    const { setStatus } = captureStatus();

    const result = await play({ type: "playlist", id: "playlist-1" }, setStatus);

    expect(result).toBe(1);
    expect(calls[1].url).toMatch(/\/playlists\/playlist-1\/items/);
    expect(calls[2].opts.method).toBe("POST");
    expect(new URL(calls[2].url).searchParams.get("uri")).toBe("spotify:track:x");
    expect(new URL(calls[2].url).searchParams.get("device_id")).toBe("phone");
});

test("play limits the queued batch to the configured batch size", async (t) => {
    const calls = stubFetch(t, [
        jsonPage({ is_playing: true, device: { id: "phone" } }),
        jsonPage({
            items: Array.from({ length: 5 }, (_, i) => trackItem(`spotify:track:${i}`)),
            next: null,
            total: 5,
        }),
        noContent(),
        noContent(),
    ]);
    global.localStorage.setItem("reshuffle:batchSize", "2");
    const { setStatus } = captureStatus();

    const result = await play({ type: "liked" }, setStatus);

    expect(result).toBe(2);
    expect(calls.length, "1 playback check + 1 library page + 2 queue calls").toBe(4);
});

test("play preserves prior queue appends and stops after a later queue failure", async (t) => {
    const calls = stubFetch(t, [
        jsonPage({ is_playing: true, device: { id: "phone" } }),
        jsonPage({
            items: [trackItem("spotify:track:a"), trackItem("spotify:track:b"), trackItem("spotify:track:c")],
            next: null,
            total: 3,
        }),
        noContent(),
        { ok: false, status: 429, headers: new Headers({ "Retry-After": "5" }) },
    ]);
    const fetchWithResponses = global.fetch;
    const appendedUris = [];
    global.fetch = async (url, opts) => {
        const response = await fetchWithResponses(url, opts);
        if (String(url).includes("/me/player/queue") && response.ok) {
            appendedUris.push(new URL(url).searchParams.get("uri"));
        }
        return response;
    };
    const { setStatus, messages } = captureStatus();

    await expect(() => play({ type: "liked" }, setStatus)).rejects.toThrow(
        /Queued 1 of 3 before this failed: Rate limited.*5 seconds/,
    );

    expect(calls.length, "should stop after the failed second queue request").toBe(4);
    const attemptedUris = calls.slice(2).map((call) => new URL(call.url).searchParams.get("uri"));
    expect(attemptedUris.length).toBe(2);
    expect(new Set(attemptedUris).size, "each attempted append has a distinct track").toBe(2);
    expect(attemptedUris.every((uri) => ["spotify:track:a", "spotify:track:b", "spotify:track:c"].includes(uri))).toBe(
        true,
    );
    expect(appendedUris, "the successful first append remains after the second fails").toEqual([attemptedUris[0]]);
    expect(messages).toEqual(["Loading library…", "Loading library… 3/3", "Queued 1/3…"]);
});
