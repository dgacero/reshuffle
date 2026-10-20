import { handleRedirect, isLoggedIn, clearTokens } from "./auth.js";
import { renderLogin, renderApp, setStatus, showError, showDevMenu } from "./ui.js";
import { getBatchSize, setBatchSize } from "./config.js";

function handleStartupError(error) {
    showError(error, () => main());
}

/**
 * Clears the current session and reloads the app. Intended for developer use
 * and not surfaced in the UI.
 */
window.devLogout = () => {
    clearTokens();
    location.reload();
};

/**
 * Gets or sets the number of songs queued by each shuffle. Intended for
 * developer use and not surfaced in the UI.
 * @param {number=} n The positive-integer batch size to store.
 * @return {number}
 */
window.devBatchSize = (n) => {
    if (n !== undefined) {
        setBatchSize(n);
    }
    return getBatchSize();
};

document.getElementById("info-btn").addEventListener("click", () => {
    document.getElementById("info-menu").hidden = false;
});
document.getElementById("info-menu-close").addEventListener("click", () => {
    document.getElementById("info-menu").hidden = true;
});

// On a phone there is no `console`, so the same dev tools are reachable by a
// hidden gesture: tap the title 7 times quickly (as with Android's build-number
// trick), opening a menu with logout and batch-size controls.
let titleTaps = 0;
let titleTapTimer = null;
document.querySelector("header").addEventListener("click", () => {
    titleTaps += 1;
    clearTimeout(titleTapTimer);
    titleTapTimer = setTimeout(() => (titleTaps = 0), 1500);
    if (titleTaps >= 7) {
        titleTaps = 0;
        showDevMenu({
            batchSize: getBatchSize(),
            onBatchSizeChange: setBatchSize,
            onLogout: window.devLogout,
        });
    }
});

/**
 * Boots the app: completes any OAuth redirect, then renders the logged-in or
 * logged-out view. A failed redirect with a live session is surfaced but still
 * drops into the app view.
 * @return {!Promise<void>}
 */
export async function main() {
    let redirectError = null;
    try {
        await handleRedirect();
    } catch (err) {
        redirectError = err;
    }

    if (!isLoggedIn()) {
        if (redirectError) {
            showError(redirectError);
        } else {
            renderLogin();
        }
        return;
    }

    // A failed redirect with a live session is still usable, so the error must
    // outlive `renderApp`, which clears the status on its way in.
    await renderApp();
    if (redirectError) {
        setStatus(redirectError.message);
    }
}

main().catch(handleStartupError);
