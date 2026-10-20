import { test, vi, afterAll, expect } from "vitest";
import { JSDOM } from "jsdom";
import { setBatchSize } from "../src/config.js";

let handleRedirectImpl = async () => {};
let loggedIn = false;
let clearTokensCalls = 0;
let renderLoginCalls = 0;
let renderAppCalls = 0;
let renderAppImpl = async () => {};
let setStatusCalls = [];
let showErrorCalls = [];
let batchSize = 100;
let setBatchSizeImpl = (size) => {
    batchSize = size;
};
let showDevMenuCalls = [];

vi.mock("../src/auth.js", () => ({
    handleRedirect: (...args) => handleRedirectImpl(...args),
    isLoggedIn: () => loggedIn,
    clearTokens: () => {
        clearTokensCalls += 1;
    },
}));

vi.mock("../src/ui.js", () => ({
    renderLogin: () => {
        renderLoginCalls += 1;
    },
    renderApp: async (...args) => {
        renderAppCalls += 1;
        return renderAppImpl(...args);
    },
    setStatus: (message) => {
        setStatusCalls.push(message);
    },
    showError: (error) => {
        showErrorCalls.push(error);
    },
    showDevMenu: (options) => {
        showDevMenuCalls.push(options);
    },
}));

vi.mock("../src/config.js", () => ({
    getBatchSize: () => batchSize,
    setBatchSize: (...args) => setBatchSizeImpl(...args),
}));

const dom = new JSDOM(
    `
    <!doctype html>
    <body>
        <header></header>
    </body>
`,
    { url: "https://app.example/" },
);
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.confirm = () => false;

const { main } = await import("../src/app.js");

test("app startup renders the login view when no session exists", async () => {
    await new Promise((resolve) => setImmediate(resolve));

    expect(renderLoginCalls).toBe(1);
    expect(clearTokensCalls).toBe(0);
});

test("developer controls manage logout and batch-size overrides", async () => {
    let reloadCalls = 0;
    global.location = { reload: () => (reloadCalls += 1) };

    expect(window.devBatchSize()).toBe(100);
    expect(window.devBatchSize(12)).toBe(12);
    window.devLogout();

    expect(clearTokensCalls).toBe(1);
    expect(reloadCalls).toBe(1);
});

test("seven title taps open the developer menu with the current batch size", () => {
    showDevMenuCalls = [];
    batchSize = 42;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let timerCallback;
    let timeoutDelay;
    global.setTimeout = (callback, delay) => {
        timerCallback = callback;
        timeoutDelay = delay;
        return 0;
    };
    global.clearTimeout = () => {};

    try {
        document.querySelector("header").click();
        timerCallback();
        for (let i = 0; i < 7; i += 1) {
            document.querySelector("header").click();
        }
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }

    expect(showDevMenuCalls.length).toBe(1);
    expect(showDevMenuCalls[0].batchSize).toBe(42);
    expect(showDevMenuCalls[0].onLogout).toBe(window.devLogout);
    expect(showDevMenuCalls[0].onBatchSizeChange).toBe(setBatchSize);
    expect(timeoutDelay).toBe(1500);
});

test("main renders the app and preserves a redirect error for an existing session", async () => {
    loggedIn = true;
    handleRedirectImpl = async () => {
        throw new Error("redirect failed");
    };
    setStatusCalls = [];

    await main();

    expect(renderAppCalls).toBe(1);
    expect(setStatusCalls).toEqual(["redirect failed"]);
});

test("main renders the app after a successful redirect", async () => {
    loggedIn = true;
    handleRedirectImpl = async () => {};
    setStatusCalls = [];

    await main();

    expect(renderAppCalls).toBe(2);
    expect(setStatusCalls).toEqual([]);
});

test("a renderApp failure after a failed redirect propagates without reporting the redirect error", async () => {
    loggedIn = true;
    handleRedirectImpl = async () => {
        throw new Error("redirect failed");
    };
    renderAppImpl = async () => {
        throw new Error("library offline");
    };
    setStatusCalls = [];

    await expect(main()).rejects.toThrow(/library offline/);

    expect(setStatusCalls).toEqual([]);
});

test("main shows a redirect error when no session exists", async () => {
    loggedIn = false;
    handleRedirectImpl = async () => {
        throw new Error("cancelled");
    };
    showErrorCalls = [];

    await main();

    expect(renderLoginCalls).toBe(1);
    expect(showErrorCalls.length).toBe(1);
    expect(showErrorCalls[0].message).toBe("cancelled");
});

afterAll(() => {
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.location;
    delete global.confirm;
});
