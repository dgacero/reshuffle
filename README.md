# Reshuffle

Reshuffle does a true random shuffle of Spotify's Liked Songs or a playlist, then adds the songs to your queue.

## Good to know

- Due to Spotify limitations, a Premium account is required.
- Nothing in your account is modified. Only your queue changes.
- The songs are added after anything already playing or waiting in Spotify's queue. It does not interrupt the current song.
- Each shuffle is a new random selection, meaning a song can appear again the next time you shuffle.
- If a song appears more than once in a playlist, it is treated as a separate entry, so that song can show up more than once in your queue.

## Development

### Install and run checks

```bash
npm install            # Install dependencies
npm test               # Run tests
npm run test:coverage  # Run tests with coverage
npm run lint           # Lint the code
npm run format         # Auto-format the code
npm run format:check   # Check formatting without changing files
```

### Running locally

Reshuffle is a static site with no build step. Serve the project root with a local web server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

### Connecting to Spotify

Logging in with Spotify locally requires your own Spotify app. Create one in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), add `http://localhost:8000` as a redirect URI, and replace `CLIENT_ID` in `src/config.js` with your app's client ID.

Spotify apps in development mode only allow logins from an allowlist of test users, so you can't reuse the maintainer's client ID. Add yourself as a test user on your own app instead.
