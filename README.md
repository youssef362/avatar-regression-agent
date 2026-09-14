# Avatar Regression Agent

A small agent that visits an AI avatar demo on a schedule, runs the workflows you
define, and reports to Telegram:

- **All good →** a summary report (which workflows passed, how long it took).
- **Something broke →** an alert titled either **🌐 AVATAR DOWN / UNREACHABLE** or
  **⚠️ AVATAR FUNCTION FAILING**, with the failing step, a "take immediate action"
  line, a full **log file**, and up to 3 failure **screenshots**.

Built on Playwright (headless Chromium). Runs every 2 hours via GitHub Actions, or
anywhere you can run Node + cron.

---

## 1. Requirements

- Node.js 18+ (uses built-in `fetch`)
- A Telegram bot

## 2. Telegram setup (one time)

1. In Telegram, message **@BotFather** → `/newbot` → copy the **bot token**.
2. Send any message to your new bot.
3. Get your **chat id**: open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and read
   `result[].message.chat.id`.

## 3. Local run

```bash
npm install
npx playwright install chromium
cp .env.example .env      # fill in your token + chat id
npm run test:once
```

## 4. Schedule it (GitHub Actions — recommended, matches your stack)

1. Push this folder to a GitHub repo.
2. Repo → **Settings → Secrets and variables → Actions** → add
   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. Done. `.github/workflows/regression.yml` runs every 2 hours and also gives you
   a manual **Run workflow** button. Logs are also uploaded as run artifacts.

> Note: GitHub's scheduled runs can start a few minutes late (sometimes more under
> load). If you need tight 2-hour timing, use the VPS option below.

### Alternative: VPS / always-on box

```bash
crontab -e
# every 2 hours
0 */2 * * * cd /path/to/avatar-regression-agent && /usr/bin/node src/runner.js >> logs/cron.log 2>&1
```

---

## 5. Defining your workflows

Everything lives in `config/workflows.json`. Each workflow is a named list of
steps. Supported actions:

| action                 | fields                                  | what it does |
|------------------------|-----------------------------------------|--------------|
| `goto`                 | –                                       | Loads the avatar URL. Fails on HTTP ≥ 400 → counts as **down**. |
| `waitForSelector`      | `selector`, `timeoutMs?`                | Waits for an element to exist. |
| `expectVisible`        | `selector`, `timeoutMs?`                | Waits for an element to be visible. |
| `click`                | `selector`, `timeoutMs?`                | Clicks an element. |
| `fill`                 | `selector`, `text`, `timeoutMs?`        | Types into an input. |
| `expectText`           | `selector`, `contains`, `timeoutMs?`    | Asserts an element contains a substring. |
| `waitForResponseText`  | `selector`, `minLength?`, `timeoutMs?`  | Waits until an element has ≥ N chars — **use this for AI replies** (don't assert exact wording). |
| `waitMs`               | `ms`                                    | Fixed pause. |
| `expectNoConsoleErrors`| –                                       | Fails the workflow if the page logged JS errors. |

- `retries` (per workflow, or top-level default) re-runs a failed workflow before
  it's declared a real failure — this absorbs occasional flakiness.

## 6. Filling in the selectors ⚠️ important

The sample config uses `REPLACE_ME_*` placeholders. Only you can supply the real
ones, since they depend on the avatar app's DOM:

1. Open the avatar URL with `&mode=debug` in Chrome.
2. Right-click the element (avatar container, start button, text input, response
   bubble) → **Inspect** → copy a stable `id`, class, or `data-*` attribute.
3. Paste it into the matching step in `config/workflows.json`.

> Tip: if you paste the page's HTML (or the key element IDs/classes) to me, I can
> fill the selectors in for you.

---

## Honest caveats (read these)

- **AI output is non-deterministic.** Never assert exact reply text — you'll get
  false alarms. Assert *behavior*: a reply arrived, within a time limit, non-empty,
  no error state. That's what `waitForResponseText` is for.
- **Voice / WebRTC is only partially testable headlessly.** The launch flags feed
  fake mic/cam so a session can start, but this does not verify that real speech
  audio is correct. For the voice path, the reliable signals are: the WebSocket
  connects, the session enters an "active/speaking" state, and no console errors.
  Treat deep audio-quality checks as out of scope for an unattended agent.
- **Alert fatigue.** Keep `retries` ≥ 1 so a single blip doesn't page you. If you
  want "only alert after N consecutive failures," that needs state stored between
  runs (e.g. a tiny value in a GitHub repo/Gist or your existing Issues-DB) — easy
  to add on top of this.
- **The URL you gave had two `?`** (`...f7f6fe47f93446c1?mode=debug`). A URL can
  only have one `?`; the second must be `&`. I corrected it to
  `...f7f6fe47f93446c1&mode=debug` in the config so debug mode actually applies.

---

## What's in this repo

Everything lives here in one place:

- `workflow-builder.html` — open in your browser to enter the avatar link and
  build workflows visually, then click **Download file** to get `workflows.json`.
  Drop that file into `config/` (replacing the placeholder). No JSON editing.
- `config/workflows.json` — the workflows the agent runs.
- `src/` — the engine (runs the browser checks, sends Telegram).
- `.github/workflows/regression.yml` — runs every 2 hours + a "Run workflow" button.

### Optional: open the builder from a GitHub URL

If you'd rather not keep the HTML on your computer, enable **GitHub Pages**
(Settings → Pages → deploy from your default branch, root) and open the builder at
`https://<your-username>.github.io/<repo>/workflow-builder.html`. It's a static
page — nothing secret is in it, so this is safe on a public repo.
