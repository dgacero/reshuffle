import { test, expect } from "vitest";
import {
    isPlayableTrack,
    fetchPlaylists,
    fetchTracks,
    fetchLikedTracks,
    getPlaybackState,
    queueTrack,
} from "../src/spotify.js";
import { fakeStorage } from "./helpers.js";

function stubApi(t, responses) {
    const calls = [];
    global.localStorage = fakeStorage([
        ["access_token", "valid-token"],
        ["refresh_token", "refresh-token"],
        ["expires_at", String(Date.now() + 60 * 60 * 1000)],
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

function playlistTrackItem(uri) {
    return { item: { uri, is_local: false, type: "track" } };
}

function likedTrackItem(uri) {
    return { track: { uri, is_local: false, type: "track" } };
}

test("isPlayableTrack keeps normal tracks and drops everything else", () => {
    expect(isPlayableTrack({ uri: "spotify:track:z", is_local: false, type: "track" })).toBe(true);
    expect(isPlayableTrack(null)).toBe(false);
    expect(isPlayableTrack({ is_local: false, type: "track" })).toBe(false);
    expect(isPlayableTrack({ uri: "spotify:local:x", is_local: true, type: "track" })).toBe(false);
    expect(isPlayableTrack({ uri: "spotify:episode:y", is_local: false, type: "episode" })).toBe(false);
});

test("fetchPlaylists follows pagination across multiple pages", async (t) => {
    const calls = stubApi(t, [
        jsonPage({
            items: [{ id: "p1" }],
            next: "https://api.spotify.com/v1/me/playlists?limit=50&offset=50",
        }),
        jsonPage({ items: [{ id: "p2" }], next: null }),
    ]);

    const playlists = await fetchPlaylists();

    expect(playlists.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(calls.length).toBe(2);
    expect(calls[1].url).toBe("https://api.spotify.com/v1/me/playlists?limit=50&offset=50");
});

test("fetchTracks collects playable uris across pages, dropping the rest", async (t) => {
    const calls = stubApi(t, [
        jsonPage({
            items: [
                playlistTrackItem("spotify:track:a"),
                { item: null },
                { item: { uri: "spotify:local:b", is_local: true, type: "track" } },
                { item: { uri: "spotify:episode:c", is_local: false, type: "episode" } },
            ],
            next: "https://api.spotify.com/v1/playlists/p1/items?offset=50",
        }),
        jsonPage({
            items: [playlistTrackItem("spotify:track:d")],
            next: null,
        }),
    ]);

    expect(await fetchTracks("p1")).toEqual(["spotify:track:a", "spotify:track:d"]);
    expect(calls.length, "should follow pagination").toBe(2);
    expect(new URL(calls[0].url).pathname).toBe("/v1/playlists/p1/items");
    expect(new URL(calls[0].url).searchParams.get("limit")).toBe("50");
    expect(new URL(calls[0].url).searchParams.get("fields")).toBe("next,total,items(item(uri,is_local,type))");
});

test("fetchTracks accepts legacy track items and encodes playlist ids", async (t) => {
    const calls = stubApi(t, [
        jsonPage({
            items: [{ track: { uri: "spotify:track:legacy", is_local: false, type: "track" } }],
            next: null,
            total: 1,
        }),
    ]);

    expect(await fetchTracks("playlist/with spaces")).toEqual(["spotify:track:legacy"]);
    expect(new URL(calls[0].url).pathname).toBe("/v1/playlists/playlist%2Fwith%20spaces/items");
});

test("fetchLikedTracks collects playable uris across pages, dropping the rest", async (t) => {
    const calls = stubApi(t, [
        jsonPage({
            items: [
                { track: { uri: "spotify:track:a", is_local: false, type: "track" } },
                { track: null },
                { track: { uri: "spotify:local:b", is_local: true, type: "track" } },
            ],
            next: "https://api.spotify.com/v1/me/tracks?offset=50",
        }),
        jsonPage({
            items: [{ track: { uri: "spotify:track:c", is_local: false, type: "track" } }],
            next: null,
        }),
    ]);

    expect(await fetchLikedTracks()).toEqual(["spotify:track:a", "spotify:track:c"]);
    expect(calls[0].url).toBe("https://api.spotify.com/v1/me/tracks?limit=50");
    expect(calls.length, "should follow pagination").toBe(2);
});

test("fetchLikedTracks reports progress and rejects an unexpected page shape", async (t) => {
    stubApi(t, [jsonPage({ items: [likedTrackItem("spotify:track:a")], next: null, total: 1 })]);
    const progress = [];

    await fetchLikedTracks((fetched, total) => progress.push([fetched, total]));
    expect(progress).toEqual([[1, 1]]);

    stubApi(t, [jsonPage({ items: null })]);
    await expect(() => fetchLikedTracks()).rejects.toThrow(/unexpected library response/);
});

test("getPlaybackState returns the state JSON, or null when nothing is active", async (t) => {
    stubApi(t, [jsonPage({ is_playing: true, device: { id: "phone" } })]);
    expect(await getPlaybackState()).toEqual({ is_playing: true, device: { id: "phone" } });

    stubApi(t, [{ ok: true, status: 204 }]);
    expect(await getPlaybackState()).toBeNull();
});

test("queueTrack POSTs the uri for the given device", async (t) => {
    const calls = stubApi(t, [{ ok: true, status: 204 }]);

    await queueTrack("device-1", "spotify:track:a");

    expect(calls[0].url).toBe("https://api.spotify.com/v1/me/player/queue?uri=spotify%3Atrack%3Aa&device_id=device-1");
    expect(calls[0].opts.method).toBe("POST");
});

test("queueTrack omits the device id when Spotify should use the active device", async (t) => {
    const calls = stubApi(t, [{ ok: true, status: 204 }]);

    await queueTrack(null, "spotify:track:a");

    expect(calls[0].url).toBe("https://api.spotify.com/v1/me/player/queue?uri=spotify%3Atrack%3Aa");
});
