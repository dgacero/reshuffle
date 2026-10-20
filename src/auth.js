import { CLIENT_ID, redirectUri, SCOPES } from "./config.js";

const REFRESH_SKEW_MS = 30_000;
const MILLISECONDS_PER_SECOND = 1000;
const RANDOM_STRING_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE_VERIFIER_LENGTH = 64;
const AUTH_STATE_LENGTH = 32;
const CODE_VERIFIER_KEY = "code_verifier";
const AUTH_STATE_KEY = "auth_state";
const REFRESH_TOKEN_KEY = "refresh_token";
const ACCESS_TOKEN_KEY = "access_token";
const EXPIRES_AT_KEY = "expires_at";
const AUTHORIZATION_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const PKCE_CHALLENGE_METHOD = "S256";
const AUTHORIZATION_CODE_GRANT = "authorization_code";
const REFRESH_TOKEN_GRANT = "refresh_token";

/**
 * Generates a URL-safe random string.
 * @param {number} length The number of random characters to generate.
 * @return {string}
 */
function randomString(length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => RANDOM_STRING_CHARS[b % RANDOM_STRING_CHARS.length]).join("");
}

/**
 * Encodes an `ArrayBuffer` as unpadded `base64url`.
 * @param {!ArrayBuffer} buffer The bytes to encode.
 * @return {string}
 */
function base64UrlEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

/**
 * Creates the `S256` PKCE challenge for a verifier.
 * @param {string} verifier The PKCE code verifier.
 * @return {!Promise<string>}
 */
async function codeChallengeFor(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64UrlEncode(digest);
}

async function requestToken(body) {
    try {
        return await fetch(TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": FORM_CONTENT_TYPE },
            body,
        });
    } catch (err) {
        throw new Error("Could not reach Spotify. Check your connection and try again.", { cause: err });
    }
}

/**
 * Begins the Authorization Code with PKCE login flow: generates a `verifier`
 * and `state`, stashes them in `sessionStorage`, and redirects to Spotify.
 * @return {!Promise<void>}
 */
export async function startLogin() {
    const verifier = randomString(CODE_VERIFIER_LENGTH);
    sessionStorage.setItem(CODE_VERIFIER_KEY, verifier);
    const challenge = await codeChallengeFor(verifier);

    const state = randomString(AUTH_STATE_LENGTH);
    sessionStorage.setItem(AUTH_STATE_KEY, state);

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri(),
        scope: SCOPES,
        code_challenge_method: PKCE_CHALLENGE_METHOD,
        code_challenge: challenge,
        state,
    });
    location.href = `${AUTHORIZATION_ENDPOINT}?${params}`;
}

/**
 * Handles the OAuth redirect back from Spotify: validates `state`, exchanges
 * the authorization code for tokens, and scrubs `code`/`state`/`error` from the
 * URL. Does nothing when the URL carries neither a `code` nor an `error`.
 * @return {!Promise<void>}
 * @throws {Error} If login was cancelled, `state` mismatches, the `verifier` is
 *     missing, or the token exchange fails.
 */
export async function handleRedirect() {
    const url = new URL(location.href);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!error && !code) {
        return;
    }

    const state = url.searchParams.get("state");
    const expectedState = sessionStorage.getItem(AUTH_STATE_KEY);
    const verifier = sessionStorage.getItem(CODE_VERIFIER_KEY);

    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    history.replaceState({}, "", url);

    if (!state || state !== expectedState) {
        throw new Error("Login failed: state mismatch.");
    }

    sessionStorage.removeItem(AUTH_STATE_KEY);
    sessionStorage.removeItem(CODE_VERIFIER_KEY);

    if (error) {
        throw new Error(`Login was cancelled: ${error}`);
    }
    if (!verifier) {
        throw new Error("Login failed: missing code verifier. Please try logging in again.");
    }

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: AUTHORIZATION_CODE_GRANT,
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier,
    });

    const res = await requestToken(body);
    if (!res.ok) {
        throw new Error(`Token exchange failed: ${res.status}`);
    }
    let data;
    try {
        data = await res.json();
    } catch (err) {
        throw new Error("Spotify returned an invalid token response. Please try logging in again.", { cause: err });
    }
    storeToken(data);
}

/**
 * Stores access-token data and preserves the existing refresh token when the
 * response does not include a replacement.
 * @param {!Object} data The token response from Spotify.
 */
function storeToken(data) {
    const expiresIn = Number(data?.expires_in);
    if (
        !data ||
        typeof data.access_token !== "string" ||
        !data.access_token ||
        !Number.isFinite(expiresIn) ||
        expiresIn <= 0
    ) {
        throw new Error("Spotify returned an invalid token response. Please try logging in again.");
    }

    const expiresAt = Date.now() + expiresIn * MILLISECONDS_PER_SECOND;
    localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
    localStorage.setItem(EXPIRES_AT_KEY, String(expiresAt));
    // Refresh tokens rotate: Spotify may omit a new one on some responses, so
    // keep the old one.
    if (data.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    }
}

/** Clears the access token (but keeps the refresh token). */
export function clearAccessToken() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
}

/** Clears every stored token, ending the session. */
export function clearTokens() {
    clearAccessToken();
    localStorage.removeItem(REFRESH_TOKEN_KEY);
}

let refreshPromise = null;

/**
 * Refreshes the access token, sharing one request among concurrent callers.
 * @return {!Promise<void>}
 * @throws {Error} If no refresh token exists or Spotify rejects the refresh.
 */
async function refreshToken() {
    if (refreshPromise) {
        return refreshPromise;
    }
    refreshPromise = (async () => {
        const refreshTokenValue = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshTokenValue) {
            throw new Error("Not logged in.");
        }

        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: REFRESH_TOKEN_GRANT,
            refresh_token: refreshTokenValue,
        });
        const res = await requestToken(body);
        if (!res.ok) {
            clearTokens();
            throw new Error("Session expired. Please log in again.");
        }
        try {
            storeToken(await res.json());
        } catch (err) {
            clearTokens();
            throw new Error("Session expired. Please log in again.", { cause: err });
        }
    })();
    try {
        await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

/**
 * Returns a valid access token, refreshing it first if it is expired or within
 * the refresh skew window. Concurrent callers share one in-flight refresh.
 * @return {!Promise<string>}
 * @throws {Error} If a refresh is required but no valid refresh token exists.
 */
export async function getValidToken() {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY) || 0);
    if (!accessToken || !Number.isFinite(expiresAt) || Date.now() > expiresAt - REFRESH_SKEW_MS) {
        await refreshToken();
    }
    return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Reports whether a session exists (a refresh token is stored).
 * @return {boolean}
 */
export function isLoggedIn() {
    return Boolean(localStorage.getItem(REFRESH_TOKEN_KEY));
}
