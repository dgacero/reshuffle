import { test, expect } from "vitest";
import { fakeStorage } from "./helpers.js";
import { getBatchSize, DEFAULT_BATCH_SIZE, redirectUri, setBatchSize } from "../src/config.js";

test("getBatchSize defaults to DEFAULT_BATCH_SIZE and honors any positive-integer override", (t) => {
    global.localStorage = fakeStorage();
    t.onTestFinished(() => delete global.localStorage);

    expect(getBatchSize(), "nothing stored").toBe(DEFAULT_BATCH_SIZE);

    global.localStorage.setItem("reshuffle:batchSize", "42");
    expect(getBatchSize(), "a developer override").toBe(42);

    global.localStorage.setItem("reshuffle:batchSize", "not-a-number");
    expect(getBatchSize(), "unparseable").toBe(DEFAULT_BATCH_SIZE);

    global.localStorage.setItem("reshuffle:batchSize", "0");
    expect(getBatchSize(), "non-positive").toBe(DEFAULT_BATCH_SIZE);

    global.localStorage.setItem("reshuffle:batchSize", "1.5");
    expect(getBatchSize(), "fractional").toBe(DEFAULT_BATCH_SIZE);
});
test("redirectUri joins origin and path without query or fragment", (t) => {
    global.location = {
        origin: "https://app.example",
        pathname: "/reshuffle/",
        search: "?code=secret",
        hash: "#section",
    };
    t.onTestFinished(() => delete global.location);

    expect(redirectUri()).toBe("https://app.example/reshuffle/");
});

test("setBatchSize rejects values that could break shuffle selection", (t) => {
    global.localStorage = fakeStorage();
    t.onTestFinished(() => delete global.localStorage);

    for (const value of [0, -1, 1.5, Number.NaN]) {
        const fn = () => setBatchSize(value);
        expect(fn).toThrow(RangeError);
        expect(fn).toThrow(/positive integer/);
    }

    setBatchSize(7);
    expect(global.localStorage.getItem("reshuffle:batchSize")).toBe("7");
});
