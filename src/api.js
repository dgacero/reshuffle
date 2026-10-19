import { getValidToken, clearAccessToken, clearTokens } from "./auth.js";

const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";
const RETRY_AFTER_HEADER = "Retry-After";

/**
 * Sends a request to the Spotify Web API with the current access token.
 * @param {string} method The HTTP method.
 * @param {string} path The API path, including any query string.
 * @param {!Object=} body An optional JSON request body.
 * @return {!Promise<Response>}
 */
async function send(method, path, body) {
    const token = await getValidToken();
    try {
        return await fetch(`${SPOTIFY_API_BASE_URL}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { "Content-Type": "application/json" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (err) {
        throw new Error("Could not reach Spotify. Check your connection and try again.", { cause: err });
    }
}

/**
 * Creates an API error that retains the HTTP status for callers that need to
 * distinguish a permission failure from other request failures.
 * @param {string} message The user-facing error message.
 * @param {number} status The HTTP status code.
 * @return {!Error} The error with its HTTP status attached.
 */
function apiError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

/**
 * Sends an authenticated request to the Spotify Web API, retrying once on a
 * `stale-token` 401 and mapping common error statuses to friendly messages.
 * @param {string} method The HTTP method.
 * @param {string} path The API path, including any query string.
 * @param {!Object=} body An optional JSON request body.
 * @return {!Promise<?Object>} The parsed JSON, or `null` for a 204 or a
 *     non-JSON command response.
 * @throws {Error} On 401 (after retry), 403, 429, an unreadable `GET` body, or
 *     any other non-OK status.
 */
export async function api(method, path, body) {
    let res = await send(method, path, body);

    // An access token can expire between the skew check and arrival. Drop it
    // and retry once so a single stale token does not force a full re-login.
    if (res.status === 401) {
        clearAccessToken();
        res = await send(method, path, body);
    }

    if (!res.ok) {
        if (res.status === 401) {
            clearTokens();
            throw apiError("Session expired. Please log in again.", res.status);
        }
        if (res.status === 403) {
            throw apiError(
                "This action isn't available (Premium or additional permission may be required).",
                res.status,
            );
        }
        if (res.status === 429) {
            const retryAfter = res.headers.get(RETRY_AFTER_HEADER);
            throw apiError(`Rate limited by Spotify. Try again in ${retryAfter || "a few"} seconds.`, res.status);
        }
        throw apiError(`Something went wrong talking to Spotify (${res.status}). Please try again.`, res.status);
    }
    if (res.status === 204) {
        return null;
    }
    // Some command endpoints (e.g. `/queue`) return 200 with a short non-JSON
    // body we do not need. Tolerate that for commands, but a `GET` is expected
    // to carry real data, so a broken body there must not look like no data.
    try {
        return await res.json();
    } catch {
        if (method === "GET") {
            throw apiError("Spotify returned an unreadable response. Please try again.", res.status);
        }
        return null;
    }
}
