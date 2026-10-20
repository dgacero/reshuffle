import { test, expect } from "vitest";
import { fakeStorage } from "./helpers.js";
import { api } from "../src/api.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Route the token endpoint separately so a cleared access token can be
// refreshed the way it would be in the browser.
function stubApi(t, apiResponses) {
    const calls = [];
    global.localStorage = fakeStorage([
        ["access_token", "token"],
        ["expires_at", String(Date.now() + 60_000)],
        ["refresh_token", "refresh"],
    ]);
    global.sessionStorage = fakeStorage();
    global.fetch = async (url, opts = {}) => {
        calls.push({ url, opts });
        if (url === TOKEN_URL) {
            return {
                ok: true,
                json: async () => ({ access_token: "refreshed", expires_in: 3600 }),
            };
        }
        return apiResponses.shift();
    };
    t.onTestFinished(() => {
        delete global.localStorage;
        delete global.sessionStorage;
        delete global.fetch;
    });
    return calls;
}

test("api sends a bearer token and no content type without a body", async (t) => {
    const calls = stubApi(t, [{ ok: true, status: 200, json: async () => ({}) }]);

    await api("GET", "/me/playlists");

    expect(calls[0].opts.headers.Authorization).toBe("Bearer token");
    expect(calls[0].opts.headers["Content-Type"]).toBeUndefined();
    expect(calls[0].opts.body).toBeUndefined();
});

test("api sends a JSON body and content type when given one", async (t) => {
    const calls = stubApi(t, [{ ok: true, status: 204 }]);

    await api("PUT", "/me/player/play", { uris: ["spotify:track:a"] });

    expect(calls[0].opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].opts.body)).toEqual({ uris: ["spotify:track:a"] });
});

test("api returns null for empty or non-JSON successful responses", async (t) => {
    stubApi(t, [{ ok: true, status: 204 }]);
    expect(await api("PUT", "/me/player/shuffle")).toBeNull();

    stubApi(t, [
        {
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError("bad");
            },
        },
    ]);
    expect(await api("POST", "/me/player/queue")).toBeNull();
});

test("api returns parsed JSON on success", async (t) => {
    stubApi(t, [{ ok: true, status: 200, json: async () => ({ hello: "world" }) }]);

    expect(await api("GET", "/me/playlists")).toEqual({ hello: "world" });
});

test("api refreshes and retries once when the first attempt is a 401", async (t) => {
    const calls = stubApi(t, [
        { ok: false, status: 401, headers: new Headers() },
        { ok: true, status: 200, json: async () => ({ hello: "world" }) },
    ]);

    expect(await api("GET", "/me/playlists")).toEqual({ hello: "world" });

    expect(calls.map((c) => c.url)).toEqual([
        "https://api.spotify.com/v1/me/playlists",
        TOKEN_URL,
        "https://api.spotify.com/v1/me/playlists",
    ]);
    expect(calls[2].opts.headers.Authorization).toBe("Bearer refreshed");
    expect(global.localStorage.getItem("refresh_token"), "keeps the session").toBe("refresh");
});

test("api clears every token when the retry is also a 401", async (t) => {
    stubApi(t, [
        { ok: false, status: 401, headers: new Headers() },
        { ok: false, status: 401, headers: new Headers() },
    ]);

    await expect(() => api("GET", "/me/playlists")).rejects.toMatchObject({
        message: expect.stringMatching(/Session expired/),
        status: 401,
    });
    expect(global.localStorage.getItem("refresh_token")).toBeNull();
    expect(global.localStorage.getItem("access_token")).toBeNull();
});
