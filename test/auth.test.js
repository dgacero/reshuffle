import { test, vi, expect } from "vitest";
import { fakeStorage } from "./helpers.js";
import { startLogin, handleRedirect, getValidToken, isLoggedIn, clearAccessToken, clearTokens } from "../src/auth.js";

// `auth.js` only touches storage/fetch inside functions, never at module load,
// so these stubs just need to exist globally before a test calls into it.

function stubRedirect(t, href, session = []) {
    const parsedUrl = new URL(href);
    global.location = {
        href,
        origin: parsedUrl.origin,
        pathname: parsedUrl.pathname,
    };
    global.history = { replaceState: () => {} };
    global.localStorage = fakeStorage();
    global.sessionStorage = fakeStorage(session);
    t.onTestFinished(() => {
        delete global.location;
        delete global.history;
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });
}

test("startLogin creates a PKCE authorization request using the current page", async (t) => {
    global.location = {
        origin: "https://app.example",
        pathname: "/reshuffle/",
        href: "https://app.example/reshuffle/",
    };
    global.sessionStorage = fakeStorage();
    t.onTestFinished(() => {
        delete global.location;
        delete global.sessionStorage;
    });

    await startLogin();

    const params = new URL(global.location.href).searchParams;
    expect(params.get("client_id")).toBe("7f6ceeedc16d41288c419aba5ada390e");
    expect(params.get("redirect_uri")).toBe("https://app.example/reshuffle/");
    expect(params.get("scope")).toBe(
        "playlist-read-private playlist-read-collaborative user-library-read user-read-playback-state user-modify-playback-state",
    );
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(global.sessionStorage.getItem("auth_state"));
    expect(global.sessionStorage.getItem("code_verifier").length).toBe(64);

    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(global.sessionStorage.getItem("code_verifier")),
    );
    expect(params.get("code_challenge")).toBe(Buffer.from(digest).toString("base64url"));
});

test("handleRedirect does nothing when the URL has no code or error", async (t) => {
    stubRedirect(t, "https://app.example/?keep=yes#section", [
        ["auth_state", "pending"],
        ["code_verifier", "pending-verifier"],
    ]);
    let historyCalls = 0;
    global.history.replaceState = () => {
        historyCalls += 1;
    };

    await handleRedirect();
    expect(global.localStorage.getItem("access_token")).toBeNull();
    expect(global.sessionStorage.getItem("auth_state")).toBe("pending");
    expect(global.sessionStorage.getItem("code_verifier")).toBe("pending-verifier");
    expect(historyCalls).toBe(0);
});

test("handleRedirect throws when the login was cancelled", async (t) => {
    stubRedirect(t, "https://app.example/?error=access_denied&state=abc", [
        ["auth_state", "abc"],
        ["code_verifier", "verifier"],
    ]);

    let replacedUrl;
    global.history.replaceState = (_state, _title, url) => {
        replacedUrl = String(url);
    };
    await expect(() => handleRedirect()).rejects.toThrow(/Login was cancelled: access_denied/);
    expect(new URL(replacedUrl).search).toBe("");
    expect(global.sessionStorage.getItem("auth_state")).toBeNull();
    expect(global.sessionStorage.getItem("code_verifier"), "must not outlive the attempt").toBeNull();
});

test("handleRedirect throws on a state mismatch", async (t) => {
    stubRedirect(t, "https://app.example/callback?code=xyz&state=wrong&keep=yes#section", [["auth_state", "expected"]]);
    let replacedUrl;
    global.history.replaceState = (_state, _title, url) => {
        replacedUrl = String(url);
    };

    await expect(() => handleRedirect()).rejects.toThrow(/state mismatch/);
    expect(new URL(replacedUrl).search).toBe("?keep=yes");
    expect(new URL(replacedUrl).hash).toBe("#section");
});

test("handleRedirect exchanges a valid code, stores token expiry, and scrubs callback secrets", async (t) => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    t.onTestFinished(() => vi.restoreAllMocks());
    stubRedirect(t, "https://app.example/callback?code=xyz&state=abc&keep=yes#section", [
        ["auth_state", "abc"],
        ["code_verifier", "verifier"],
    ]);
    let request;
    global.fetch = async (url, options) => {
        request = { url, options };
        return {
            ok: true,
            json: async () => ({
                access_token: "new-token",
                expires_in: 3600,
                refresh_token: "refresh",
            }),
        };
    };

    let replacedUrl;
    global.history.replaceState = (_state, _title, url) => {
        replacedUrl = String(url);
    };
    await handleRedirect();

    expect(request.url).toBe("https://accounts.spotify.com/api/token");
    expect(request.options.method).toBe("POST");
    expect(request.options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(request.options.body);
    expect(body.get("client_id")).toBe("7f6ceeedc16d41288c419aba5ada390e");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("xyz");
    expect(body.get("redirect_uri")).toBe("https://app.example/callback");
    expect(body.get("code_verifier")).toBe("verifier");

    expect(global.localStorage.getItem("access_token")).toBe("new-token");
    expect(global.localStorage.getItem("expires_at")).toBe(String(now + 3600_000));
    expect(global.sessionStorage.getItem("refresh_token")).toBe("refresh");
    expect(new URL(replacedUrl).search).toBe("?keep=yes");
    expect(new URL(replacedUrl).hash).toBe("#section");
    expect(global.sessionStorage.getItem("code_verifier"), "single use only").toBeNull();
});

test("handleRedirect keeps the existing refresh token when code exchange omits one", async (t) => {
    stubRedirect(t, "https://app.example/?code=xyz&state=abc", [
        ["auth_state", "abc"],
        ["code_verifier", "verifier"],
        ["refresh_token", "existing-refresh"],
    ]);
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ access_token: "new-token", expires_in: 3600 }),
    });

    await handleRedirect();

    expect(global.localStorage.getItem("access_token")).toBe("new-token");
    expect(global.sessionStorage.getItem("refresh_token")).toBe("existing-refresh");
});

test("getValidToken shares one in-flight refresh across concurrent callers", async (t) => {
    global.localStorage = fakeStorage([
        ["access_token", "stale-access-token"],
        ["expires_at", "0"],
    ]);
    global.sessionStorage = fakeStorage([["refresh_token", "old-refresh-token"]]);

    let fetchCalls = 0;
    let request;
    global.fetch = async (url, options) => {
        request = { url, options };
        fetchCalls += 1;
        return {
            ok: true,
            json: async () => ({
                access_token: `fresh-token-${fetchCalls}`,
                expires_in: 3600,
                refresh_token: `rotated-refresh-token-${fetchCalls}`,
            }),
        };
    };
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });

    const [first, second] = await Promise.all([getValidToken(), getValidToken()]);

    expect(fetchCalls, "two concurrent calls should trigger only one refresh request").toBe(1);
    expect(first).toBe(second);
    expect(first).toBe("fresh-token-1");
    expect(request.url).toBe("https://accounts.spotify.com/api/token");
    expect(request.options.method).toBe("POST");

    const body = new URLSearchParams(request.options.body);
    expect(body.get("client_id")).toBe("7f6ceeedc16d41288c419aba5ada390e");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
    expect(global.sessionStorage.getItem("refresh_token")).toBe("rotated-refresh-token-1");
});

test("a refresh network failure preserves the session for retry", async (t) => {
    global.localStorage = fakeStorage([["expires_at", "0"]]);
    global.sessionStorage = fakeStorage([["refresh_token", "still-valid"]]);
    global.fetch = async () => {
        throw new Error("offline");
    };
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });

    await expect(() => getValidToken()).rejects.toThrow(/Could not reach Spotify/);
    expect(global.sessionStorage.getItem("refresh_token")).toBe("still-valid");
});

test("a failed refresh clears the session", async (t) => {
    global.localStorage = fakeStorage([["expires_at", "0"]]);
    global.sessionStorage = fakeStorage([["refresh_token", "revoked"]]);
    global.fetch = async () => ({ ok: false, status: 400 });
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });

    await expect(() => getValidToken()).rejects.toThrow(/Session expired/);
    expect(global.sessionStorage.getItem("refresh_token")).toBeNull();
});

test("a refresh that returns a malformed token body clears the session", async (t) => {
    global.localStorage = fakeStorage([["expires_at", "0"]]);
    global.sessionStorage = fakeStorage([["refresh_token", "stale"]]);
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ expires_in: 3600 }),
    });
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });

    await expect(() => getValidToken()).rejects.toThrow(/Session expired/);
    expect(global.sessionStorage.getItem("refresh_token")).toBeNull();
});

test("getValidToken explains when an expired token has no refresh token", async (t) => {
    global.localStorage = fakeStorage([
        ["access_token", "expired"],
        ["expires_at", "0"],
    ]);
    global.sessionStorage = fakeStorage();
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
    });

    await expect(() => getValidToken()).rejects.toThrow(/Not logged in/);
});

test("clearAccessToken preserves refresh credentials and clearTokens removes them", (t) => {
    global.localStorage = fakeStorage([
        ["access_token", "access"],
        ["expires_at", "123"],
    ]);
    global.sessionStorage = fakeStorage([["refresh_token", "refresh"]]);
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
    });

    clearAccessToken();
    expect(global.localStorage.getItem("access_token")).toBeNull();
    expect(global.localStorage.getItem("expires_at")).toBeNull();
    expect(global.sessionStorage.getItem("refresh_token")).toBe("refresh");

    clearTokens();
    expect(global.sessionStorage.getItem("refresh_token")).toBeNull();
});

test("getValidToken returns the stored token without refreshing when still fresh", async (t) => {
    global.localStorage = fakeStorage([
        ["access_token", "still-fresh"],
        ["expires_at", String(Date.now() + 60_000)],
    ]);
    global.sessionStorage = fakeStorage([["refresh_token", "refresh"]]);
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        throw new Error("should not be called");
    };
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });

    expect(await getValidToken()).toBe("still-fresh");
    expect(fetchCalls).toBe(0);
});

test("getValidToken refreshes a token inside the refresh skew window", async (t) => {
    global.localStorage = fakeStorage([
        ["access_token", "almost-expired"],
        ["expires_at", String(Date.now() + 29_999)],
    ]);
    global.sessionStorage = fakeStorage([["refresh_token", "refresh"]]);
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        return {
            ok: true,
            json: async () => ({ access_token: "refreshed", expires_in: 3600 }),
        };
    };
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });

    expect(await getValidToken()).toBe("refreshed");
    expect(fetchCalls).toBe(1);
});

test("isLoggedIn reflects whether a refresh token is stored", (t) => {
    global.sessionStorage = fakeStorage();
    t.onTestFinished(() => delete global.sessionStorage);

    expect(isLoggedIn()).toBe(false);
    global.sessionStorage.setItem("refresh_token", "refresh");
    expect(isLoggedIn()).toBe(true);
});
