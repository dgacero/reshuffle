import { api } from "./api.js";

const PAGE_SIZE = 50;
const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";
const PLAYLIST_ITEM_FIELDS = "next,total,items(item(uri,is_local,type))";

function requireItemsPage(data) {
    if (!data || !Array.isArray(data.items)) {
        throw new Error("Spotify returned an unexpected library response. Please try again.");
    }
    return data;
}

/**
 * Fetches all of the user's playlists, following pagination.
 * @return {!Promise<!Array<!Object>>}
 * @throws {Error} If Spotify rejects a request.
 */
export async function fetchPlaylists() {
    const playlists = [];
    let url = `/me/playlists?limit=${PAGE_SIZE}`;
    while (url) {
        let data;
        try {
            data = requireItemsPage(await api("GET", url));
        } catch (err) {
            if (err.status === 403) {
                throw new Error("Spotify did not grant access to your playlists. Try logging in again.", {
                    cause: err,
                });
            }
            throw err;
        }
        playlists.push(...data.items);
        url = data.next ? data.next.replace(SPOTIFY_API_BASE_URL, "") : null;
    }
    return playlists;
}

/**
 * Reports whether a track can be queued (a real, non-local track).
 * @param {?Object} track The track object from a playlist item.
 * @return {boolean}
 */
export function isPlayableTrack(track) {
    return (
        Boolean(track) &&
        typeof track.uri === "string" &&
        track.uri.startsWith("spotify:track:") &&
        !track.is_local &&
        track.type === "track"
    );
}

/**
 * Fetches a playlist's playable track URIs, following pagination.
 * @param {string} playlistId The playlist `id`.
 * @param {function(number, number): void=} onProgress Called with (`fetched`,
 *     `total`) after each page.
 * @return {!Promise<!Array<string>>}
 * @throws {Error} If Spotify rejects a request.
 */
export async function fetchTracks(playlistId, onProgress) {
    const uris = [];
    let fetched = 0;
    let url =
        `/playlists/${encodeURIComponent(playlistId)}/items?limit=${PAGE_SIZE}` +
        `&fields=${encodeURIComponent(PLAYLIST_ITEM_FIELDS)}`;

    while (url) {
        let data;
        try {
            data = requireItemsPage(await api("GET", url));
        } catch (err) {
            if (err.status === 403) {
                throw new Error("Spotify only exposes playlist items for playlists you own or collaborate on.", {
                    cause: err,
                });
            }
            throw err;
        }
        for (const item of data.items) {
            const track = item?.item ?? item?.track;
            if (isPlayableTrack(track)) {
                uris.push(track.uri);
            }
        }
        fetched += data.items.length;
        if (onProgress) {
            onProgress(fetched, data.total);
        }
        url = data.next ? data.next.replace(SPOTIFY_API_BASE_URL, "") : null;
    }
    return uris;
}

/**
 * Fetches the user's `Liked Songs` track URIs, following pagination. Unlike a
 * playlist, it comes from a separate endpoint that caps `limit` at 50 and does
 * not accept a `fields` filter.
 * @param {function(number, number): void=} onProgress Called with (`fetched`,
 *     `total`) after each page.
 * @return {!Promise<!Array<string>>}
 * @throws {Error} If Spotify rejects a request.
 */
export async function fetchLikedTracks(onProgress) {
    const uris = [];
    let fetched = 0;
    let url = `/me/tracks?limit=${PAGE_SIZE}`;
    while (url) {
        const data = requireItemsPage(await api("GET", url));
        for (const item of data.items) {
            if (isPlayableTrack(item?.track)) {
                uris.push(item.track.uri);
            }
        }
        fetched += data.items.length;
        if (onProgress) {
            onProgress(fetched, data.total);
        }
        url = data.next ? data.next.replace(SPOTIFY_API_BASE_URL, "") : null;
    }
    return uris;
}

/**
 * Fetches the current playback state.
 * @return {!Promise<?Object>} The playback state, or `null` (HTTP 204) when
 *     nothing is active.
 * @throws {Error} If Spotify rejects the request.
 */
export async function getPlaybackState() {
    return api("GET", "/me/player");
}

/**
 * Appends one track to the device's queue. Mobile Spotify rejects a bare `uris`
 * list on `/play` but accepts the queue, which keeps the order tracks are added
 * in, so this is how a custom order is built.
 * @param {?string} deviceId The target `device_id`, or `null` to use the active
 *     device.
 * @param {string} uri The track URI to queue.
 * @return {!Promise<void>}
 * @throws {Error} If Spotify rejects the request.
 */
export async function queueTrack(deviceId, uri) {
    const params = new URLSearchParams({ uri });
    if (deviceId) {
        params.set("device_id", deviceId);
    }
    await api("POST", `/me/player/queue?${params}`);
}
