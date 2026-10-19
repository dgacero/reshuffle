import { getBatchSize } from "./config.js";
import { fetchTracks, fetchLikedTracks, getPlaybackState, queueTrack } from "./spotify.js";
import { shuffledBatch } from "./shuffle.js";

/**
 * Fetches a source's tracks, samples a shuffled batch, and appends it to the
 * active device's queue. Requires an already-active playback session; the Web
 * API cannot cold-start an idle device.
 * @param {{type: string, id: (string|undefined)}} source The `liked` source, or
 *     a `playlist` with an `id`.
 * @param {function(string): void} setStatus The progress-message callback.
 * @return {!Promise<number|undefined>} The number of tracks queued, or
 *     undefined when there was no active device.
 * @throws {Error} If playback state, track fetching, or queueing fails.
 */
export async function play(source, setStatus) {
    if (!source || (source.type !== "liked" && (source.type !== "playlist" || !source.id))) {
        throw new TypeError("Choose a valid playlist or Liked Songs source.");
    }

    // The Web API cannot cold-start an idle phone, so there must already be an
    // active session to append to. Target whatever device is actually playing.
    const state = await getPlaybackState();
    if (!state || !state.is_playing || !state.device) {
        setStatus("");
        return;
    }
    const activeId = state.device.id;

    setStatus("Loading library…");
    const onProgress = (loaded, total) => setStatus(`Loading library… ${loaded}/${total}`);
    const uris =
        source.type === "liked" ? await fetchLikedTracks(onProgress) : await fetchTracks(source.id, onProgress);
    if (uris.length === 0) {
        setStatus("Nothing playable to shuffle here.");
        return;
    }

    const batch = shuffledBatch(uris, getBatchSize());

    // Append each track to the end of the queue, in our shuffled order. Nothing
    // currently playing is interrupted.
    for (let i = 0; i < batch.length; i += 1) {
        try {
            await queueTrack(activeId, batch[i]);
        } catch (err) {
            throw i === 0
                ? err
                : new Error(`Queued ${i} of ${batch.length} before this failed: ${err.message}`, { cause: err });
        }
        setStatus(`Queued ${i + 1}/${batch.length}…`);
    }
    return batch.length;
}
