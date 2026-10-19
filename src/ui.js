import { startLogin, isLoggedIn } from "./auth.js";
import { fetchPlaylists, getPlaybackState } from "./spotify.js";
import { play } from "./player.js";

let statusTimer = null;
let actionInProgress = false;
const STATUS_FLASH_DURATION_MS = 4000;

/**
 * Sets the status line text, optionally styled as an error.
 * @param {string} text The message to display.
 * @param {boolean=} isError Whether to style the message as an error.
 */
export function setStatus(text, isError = false) {
    clearTimeout(statusTimer);
    const el = document.getElementById("status");
    el.textContent = text;
    el.classList.toggle("error", isError);
}

/**
 * Shows a status message, then clears it after a few seconds (for terminal
 * confirmations like `Queued N songs.`).
 * @param {string} text The message to display.
 */
function flashStatus(text) {
    setStatus(text);
    statusTimer = setTimeout(() => setStatus(""), STATUS_FLASH_DURATION_MS);
}

function setDeviceActionsDisabled(disabled) {
    for (const button of document.querySelectorAll(".needs-device")) {
        button.disabled = disabled || button.dataset.baseDisabled === "true";
    }
}

/**
 * Shows an error on the status line and, if the session was cleared (e.g. by a
 * 401 deeper in the stack), re-renders the login button.
 * @param {!Error} err The error to display.
 * @param {function(): !Promise<void>=} onRetry Optional startup retry callback.
 */
export function showError(err, onRetry) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(message, true);
    if (!isLoggedIn()) {
        renderLogin();
        return;
    }
    if (onRetry && document.getElementById("app").childElementCount === 0) {
        const retry = document.createElement("button");
        retry.className = "primary";
        retry.textContent = "Try again";
        retry.onclick = async () => {
            retry.disabled = true;
            try {
                await onRetry();
            } catch (error) {
                retry.disabled = false;
                showError(error, onRetry);
            }
        };
        document.getElementById("app").appendChild(retry);
    }
}

/**
 * Fetches the current playback state and updates the device pill plus the
 * disabled state of every `.needs-device` button.
 * @return {!Promise<void>}
 */
async function refreshDevice() {
    const el = document.getElementById("device");
    let state;
    try {
        state = await getPlaybackState();
    } catch (err) {
        showError(err);
        el.textContent = "Could not check playback status.";
        el.classList.add("error");
        setDeviceActionsDisabled(true);
        return;
    }
    const hasDevice = Boolean(state && state.is_playing && state.device);
    el.textContent = hasDevice ? `Playing on ${state.device.name}` : "No device found. Open Spotify and press play.";
    el.classList.toggle("error", !hasDevice);
    // Play actions require an active device; keep each button's own reason too.
    setDeviceActionsDisabled(actionInProgress || !hasDevice);
}

/**
 * Refreshes the device on tab re-focus, catching the common same-device flow
 * (switch to Spotify, press play, switch back) instantly. Cross-device changes
 * (e.g. pressing play on a phone while this page is open on a PC) have no such
 * signal, so those need the manual refresh button instead.
 */
function onVisible() {
    if (document.visibilityState === "visible") {
        refreshDevice();
    }
}

/**
 * Renders the logged-out view: a single `Log in with Spotify` button. Tears
 * down the visibility listener used by the app view.
 */
export function renderLogin() {
    actionInProgress = false;
    const appEl = document.getElementById("app");
    document.body.classList.add("login-view");
    document.removeEventListener("visibilitychange", onVisible);
    appEl.innerHTML = "";
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = "Log in with Spotify";
    button.onclick = () => startLogin().catch(showError);
    appEl.appendChild(button);
}

/**
 * Creates an `<option>` element.
 * @param {string} value The option `value`.
 * @param {string} text The visible label.
 * @return {!HTMLOptionElement}
 */
function optionEl(value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
}

/**
 * Renders the logged-in view: a `Liked Songs` button and a playlist picker,
 * then wires up the manual device refresh.
 * @return {!Promise<void>}
 * @throws {Error} If the playlist request fails.
 */
export async function renderApp() {
    document.body.classList.remove("login-view");
    setStatus("Loading your library…");
    const playlists = await fetchPlaylists();
    setStatus("");

    // Liked Songs action.
    const likedBtn = document.createElement("button");
    likedBtn.className = "primary needs-device";
    likedBtn.disabled = true;
    likedBtn.textContent = "Play Liked Songs";

    // Chosen playlist action.
    const playlistSelect = document.createElement("select");
    playlistSelect.setAttribute("aria-label", "Playlist");
    if (playlists.length === 0) {
        playlistSelect.appendChild(optionEl("", "No playlists found"));
        playlistSelect.disabled = true;
    } else {
        for (const p of playlists) {
            playlistSelect.appendChild(optionEl(p.id, p.name));
        }
    }
    const playBtn = document.createElement("button");
    playBtn.className = "secondary needs-device";
    playBtn.textContent = "Play";
    playBtn.disabled = true;
    playBtn.dataset.baseDisabled = String(playlists.length === 0);
    const runPlay = async (source) => {
        if (actionInProgress) {
            return;
        }
        actionInProgress = true;
        setDeviceActionsDisabled(true);
        try {
            const count = await play(source, setStatus);
            if (count) {
                flashStatus(`Queued ${count} song${count === 1 ? "" : "s"}.`);
            }
        } catch (err) {
            showError(err);
        } finally {
            actionInProgress = false;
            await refreshDevice();
        }
    };
    likedBtn.onclick = () => runPlay({ type: "liked" });
    playBtn.onclick = () => runPlay({ type: "playlist", id: playlistSelect.value });
    const playlistRow = document.createElement("div");
    playlistRow.className = "row";
    playlistRow.append(playlistSelect, playBtn);

    const appEl = document.getElementById("app");
    appEl.innerHTML = "";
    appEl.append(likedBtn, playlistRow);

    // Auto-detect the device once on load; after that the user refreshes via
    // the button (or by re-focusing the tab) instead of us polling forever.
    refreshDevice();
    const refreshBtn = document.getElementById("device-refresh");
    refreshBtn.onclick = () => {
        refreshBtn.disabled = true;
        refreshDevice().finally(() => (refreshBtn.disabled = false));
    };
    document.addEventListener("visibilitychange", onVisible);
}
