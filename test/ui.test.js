import { test, vi, expect } from "vitest";
import { fireEvent, getAllByRole, getByRole } from "@testing-library/dom";
import { JSDOM } from "jsdom";

let loggedIn = true;
let startLoginImpl = async () => {};
let fetchPlaylistsImpl = async () => [];
let getPlaybackStateImpl = async () => null;
let playImpl = async () => undefined;

const TEST_PLAYLIST = { id: "playlist-1", name: "Road Trip" };
const TEST_DEVICE = { id: "device-1", name: "Phone" };

vi.mock("../src/auth.js", () => ({
    startLogin: (...args) => startLoginImpl(...args),
    isLoggedIn: () => loggedIn,
}));

vi.mock("../src/spotify.js", () => ({
    fetchPlaylists: (...args) => fetchPlaylistsImpl(...args),
    getPlaybackState: (...args) => getPlaybackStateImpl(...args),
}));

vi.mock("../src/player.js", () => ({
    play: (...args) => playImpl(...args),
}));

const { renderLogin, renderApp } = await import("../src/ui.js");

function createDom() {
    const dom = new JSDOM(`
        <!doctype html>
        <body>
            <div id="app"></div>
            <div id="device"></div>
            <button id="device-refresh" type="button" aria-label="Refresh device"></button>
            <div id="status"></div>
        </body>
    `);
    global.window = dom.window;
    global.document = dom.window.document;
    return dom;
}

function cleanupDom(t, dom) {
    t.onTestFinished(() => {
        dom.window.close();
        delete global.window;
        delete global.document;
    });
}

function setupTest(t) {
    resetStubs();
    const dom = createDom();
    cleanupDom(t, dom);
    return dom;
}

function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

function resetStubs() {
    loggedIn = true;
    startLoginImpl = async () => {};
    fetchPlaylistsImpl = async () => [];
    getPlaybackStateImpl = async () => null;
    playImpl = async () => undefined;
}

test("renderLogin creates a login button and starts login when clicked", async (t) => {
    setupTest(t);
    let loginCalls = 0;
    startLoginImpl = async () => {
        loginCalls += 1;
    };

    renderLogin();

    const button = getByRole(document, "button", { name: "Log in with Spotify" });
    expect(document.body.classList.contains("login-view")).toBe(true);
    expect(button.textContent).toBe("Log in with Spotify");
    fireEvent.click(button);
    await flush();
    expect(loginCalls).toBe(1);
});

test("renderLogin displays a login failure and keeps the logged-out view", async (t) => {
    setupTest(t);
    loggedIn = false;
    startLoginImpl = async () => {
        throw new Error("login offline");
    };

    renderLogin();
    fireEvent.click(getByRole(document, "button", { name: "Log in with Spotify" }));
    await flush();

    expect(document.querySelector("#status").textContent).toBe("login offline");
    expect(document.querySelector("#status").classList.contains("error")).toBe(true);
    expect(document.body.classList.contains("login-view")).toBe(true);
});

test("showError keeps the app view when an Error occurs in an active session", async (t) => {
    setupTest(t);

    const { showError } = await import("../src/ui.js");
    showError(new Error("active-session failure"));

    expect(document.querySelector("#status").textContent).toBe("active-session failure");
    expect(document.querySelector("#status").classList.contains("error")).toBe(true);
    expect(document.body.classList.contains("login-view")).toBe(false);
});

test("showError offers a retry action when startup has no app controls", async (t) => {
    setupTest(t);
    let retryCalls = 0;

    const { showError } = await import("../src/ui.js");
    showError(new Error("library offline"), async () => {
        retryCalls += 1;
    });

    const retry = getByRole(document, "button", { name: "Try again" });
    fireEvent.click(retry);
    await flush();

    expect(retryCalls).toBe(1);
});

test("showError restores the login view after session loss", async (t) => {
    for (const error of ["session ended", new Error("session expired")]) {
        setupTest(t);
        loggedIn = false;

        const { showError } = await import("../src/ui.js");
        showError(error);

        expect(document.querySelector("#status").textContent).toBe(error instanceof Error ? error.message : error);
        expect(document.body.classList.contains("login-view")).toBe(true);
        expect(getByRole(document, "button", { name: "Log in with Spotify" }).textContent).toBe("Log in with Spotify");
    }
});

test("renderApp propagates a library-loading failure without rendering controls", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => {
        throw new Error("library offline");
    };

    await expect(() => renderApp()).rejects.toThrow(/library offline/);
    await flush();

    expect(document.querySelector("#status").textContent).toBe("Loading your library…");
    expect(document.querySelector("#app").childElementCount).toBe(0);
});

test("renderApp renders playlists and enables actions for an active device", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST];
    getPlaybackStateImpl = async () => ({ is_playing: true, device: TEST_DEVICE });
    let selectedSource;
    playImpl = async (source) => {
        selectedSource = source;
    };

    await renderApp();
    await flush();

    const select = getByRole(document, "combobox", { name: "Playlist" });
    const buttons = getAllByRole(document, "button", { name: /^Play/ });
    expect(select.options[0].textContent).toBe("Road Trip");
    expect(buttons.length).toBe(2);
    expect([...buttons].every((button) => !button.disabled)).toBe(true);
    expect(document.querySelector("#device").textContent).toBe("Playing on Phone");

    fireEvent.click(getByRole(document, "button", { name: "Play" }));
    await flush();
    expect(selectedSource).toEqual({ type: "playlist", id: "playlist-1" });
});

test("renderApp plays the playlist currently selected by the user", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST, { id: "playlist-2", name: "Focus" }];
    getPlaybackStateImpl = async () => ({ is_playing: true, device: TEST_DEVICE });
    let selectedSource;
    playImpl = async (source) => {
        selectedSource = source;
    };

    await renderApp();
    await flush();
    const select = getByRole(document, "combobox", { name: "Playlist" });
    select.value = "playlist-2";
    fireEvent.click(getByRole(document, "button", { name: "Play" }));
    await flush();

    expect(selectedSource).toEqual({ type: "playlist", id: "playlist-2" });
});

test("renderApp disables actions and reports a device refresh failure", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST];
    getPlaybackStateImpl = async () => {
        throw new Error("offline");
    };

    await renderApp();
    await flush();

    expect(document.querySelector("#device").textContent).toBe("Could not check playback status.");
    expect(document.querySelector("#status").textContent).toBe("offline");
    expect(document.querySelector("#device").classList.contains("error")).toBe(true);
    expect(getAllByRole(document, "button", { name: /^Play/ }).every((button) => button.disabled)).toBe(true);
});

test("renderApp handles an empty library and a missing active device", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [];
    getPlaybackStateImpl = async () => ({ is_playing: false, device: { name: "Phone" } });

    await renderApp();
    await flush();

    const select = getByRole(document, "combobox", { name: "Playlist" });
    expect(select.disabled).toBe(true);
    expect(select.options[0].textContent).toBe("No playlists found");
    expect(document.querySelector("#device").textContent).toBe("No device found. Open Spotify and press play.");
    expect(document.querySelector("#device").classList.contains("error")).toBe(true);
    expect(getAllByRole(document, "button", { name: /^Play/ }).every((button) => button.disabled)).toBe(true);
});

test("renderApp keeps Liked Songs available when the library has no playlists", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [];
    getPlaybackStateImpl = async () => ({ is_playing: true, device: TEST_DEVICE });

    await renderApp();
    await flush();

    const select = getByRole(document, "combobox", { name: "Playlist" });
    expect(select.disabled).toBe(true);
    expect(getByRole(document, "button", { name: "Play Liked Songs" }).disabled).toBe(false);
    expect(getByRole(document, "button", { name: "Play" }).disabled).toBe(true);
});

test("refresh button and visible-tab events re-check the playback device", async (t) => {
    const dom = setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST];
    let stateCalls = 0;
    getPlaybackStateImpl = async () => {
        stateCalls += 1;
        return { is_playing: true, device: TEST_DEVICE };
    };

    await renderApp();
    await flush();
    expect(stateCalls).toBe(1);

    const refresh = getByRole(document, "button", { name: "Refresh device" });
    fireEvent.click(refresh);
    await flush();
    expect(stateCalls).toBe(2);
    expect(refresh.disabled).toBe(false);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new dom.window.Event("visibilitychange"));
    await flush();
    expect(stateCalls).toBe(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new dom.window.Event("visibilitychange"));
    await flush();
    expect(stateCalls).toBe(3);
});

test("renderApp ignores a second play click while the first action is running", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST];
    getPlaybackStateImpl = async () => ({ is_playing: true, device: TEST_DEVICE });
    let playCalls = 0;
    let finishPlay;
    playImpl = () => {
        playCalls += 1;
        return new Promise((resolve) => {
            finishPlay = resolve;
        });
    };

    await renderApp();
    await flush();
    const button = getByRole(document, "button", { name: "Play Liked Songs" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(playCalls).toBe(1);
    expect(button.disabled).toBe(true);

    finishPlay();
    await flush();
    await flush();
    expect(button.disabled).toBe(false);
});

test("renderApp flashes the queued message, then clears it", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST];
    getPlaybackStateImpl = async () => ({ is_playing: true, device: TEST_DEVICE });
    playImpl = async () => 2;

    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers = [];
    global.setTimeout = (callback) => {
        timers.push(callback);
        return timers.length;
    };
    global.clearTimeout = () => {};

    try {
        await renderApp();
        await flush();
        fireEvent.click(getByRole(document, "button", { name: "Play Liked Songs" }));
        await flush();
        await flush();

        expect(document.querySelector("#status").textContent).toBe("Queued 2 songs.");
        timers.at(-1)();
        expect(document.querySelector("#status").textContent).toBe("");
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test("renderApp shows play failures and recovers the device controls", async (t) => {
    setupTest(t);
    fetchPlaylistsImpl = async () => [TEST_PLAYLIST];
    getPlaybackStateImpl = async () => ({ is_playing: true, device: TEST_DEVICE });
    playImpl = async () => {
        throw new Error("queue failed");
    };

    await renderApp();
    await flush();
    fireEvent.click(getByRole(document, "button", { name: "Play Liked Songs" }));
    await flush();
    await flush();

    expect(document.querySelector("#status").textContent).toBe("queue failed");
    expect(document.querySelector("#status").classList.contains("error")).toBe(true);
    expect(getByRole(document, "button", { name: "Play Liked Songs" }).disabled).toBe(false);
});
