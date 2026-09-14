// src/runner.js
// Loads config/workflows.json, runs each workflow with Playwright, and reports to Telegram.
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { sendMessage, sendDocument, sendPhoto } = require('./telegram');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config', 'workflows.json');
const LOG_DIR = path.join(__dirname, '..', 'logs');

const ts = () => new Date().toISOString();
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function makeLogger() {
  const lines = [];
  const write = (level, msg) => {
    const line = `[${ts()}] ${level} ${msg}`;
    lines.push(line);
    console.log(line);
  };
  return {
    info: (m) => write('INFO ', m),
    warn: (m) => write('WARN ', m),
    error: (m) => write('ERROR', m),
    dump: () => lines.join('\n'),
  };
}

async function runStep(page, step, ctx, log) {
  const t = step.timeoutMs || ctx.defaultTimeoutMs;
  switch (step.action) {
    case 'goto': {
      log.info(`goto ${ctx.url}`);
      const resp = await page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: t });
      const status = resp ? resp.status() : 0;
      log.info(`HTTP status ${status}`);
      if (!resp || status >= 400) throw new Error(`Navigation returned status ${status}`);
      break;
    }
    case 'waitForSelector':
      log.info(`waitForSelector ${step.selector}`);
      await page.waitForSelector(step.selector, { timeout: t });
      break;
    case 'expectVisible':
      log.info(`expectVisible ${step.selector}`);
      await page.waitForSelector(step.selector, { state: 'visible', timeout: t });
      break;
    case 'click':
      log.info(`click ${step.selector}`);
      await page.click(step.selector, { timeout: t });
      break;
    case 'fill':
      log.info(`fill ${step.selector}`);
      await page.fill(step.selector, step.text || '', { timeout: t });
      break;
    case 'expectText': {
      log.info(`expectText ${step.selector} contains "${step.contains}"`);
      const el = await page.waitForSelector(step.selector, { timeout: t });
      const text = (await el.textContent()) || '';
      if (!text.includes(step.contains)) {
        throw new Error(`Expected "${step.selector}" to contain "${step.contains}", got "${text.trim().slice(0, 120)}"`);
      }
      break;
    }
    case 'waitForResponseText': {
      // Non-deterministic AI output: wait until the element holds at least `minLength` chars.
      const minLength = step.minLength || 1;
      log.info(`waitForResponseText ${step.selector} minLength ${minLength}`);
      await page.waitForFunction(
        ({ sel, min }) => {
          const e = document.querySelector(sel);
          return e && (e.textContent || '').trim().length >= min;
        },
        { sel: step.selector, min: minLength },
        { timeout: t }
      );
      break;
    }
    case 'waitMs':
      log.info(`waitMs ${step.ms}`);
      await page.waitForTimeout(step.ms);
      break;
    case 'expectNoConsoleErrors':
      // Flag; actually asserted at end of the workflow.
      ctx.checkConsoleErrors = true;
      break;
    default:
      throw new Error(`Unknown action "${step.action}"`);
  }
}

async function runWorkflow(context, wf, base, log) {
  const retries = wf.retries != null ? wf.retries : base.defaultRetries;
  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    attempt++;
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    const ctx = { ...base, checkConsoleErrors: false };
    try {
      log.info(`--- Workflow "${wf.name}" attempt ${attempt}/${retries + 1} ---`);
      for (const step of wf.steps) await runStep(page, step, ctx, log);
      if (ctx.checkConsoleErrors && consoleErrors.length) {
        throw new Error(`Console errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
      }
      log.info(`PASS "${wf.name}"`);
      await page.close();
      return { name: wf.name, ok: true, attempts: attempt };
    } catch (err) {
      lastErr = err;
      log.error(`FAIL "${wf.name}" attempt ${attempt}: ${err.message}`);
      if (consoleErrors.length) log.warn(`console: ${consoleErrors.slice(0, 5).join(' | ')}`);
      try {
        const p = path.join(LOG_DIR, `fail-${wf.name.replace(/\W+/g, '_')}-${Date.now()}.png`);
        await page.screenshot({ path: p, fullPage: true });
        base.screenshots.push(p);
        log.info(`failure screenshot ${p}`);
      } catch (_) { /* ignore */ }
      await page.close();
    }
  }
  return { name: wf.name, ok: false, attempts: attempt, error: lastErr ? lastErr.message : 'unknown' };
}

async function main() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = makeLogger();
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const avatar = config.avatar;

  log.info(`Regression run for "${avatar.name}"`);
  log.info(`URL ${avatar.url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',        // auto-accept mic/cam prompts
      '--use-fake-device-for-media-stream',    // feed fake audio/video (for voice avatars)
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone', 'camera'],
  });

  const base = {
    url: avatar.url,
    defaultTimeoutMs: avatar.stepTimeoutMs || 20000,
    defaultRetries: config.retries != null ? config.retries : 1,
    screenshots: [],
  };

  const started = Date.now();
  const results = [];
  for (const wf of config.workflows) results.push(await runWorkflow(context, wf, base, log));
  const durationS = ((Date.now() - started) / 1000).toFixed(1);
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  const logFile = path.join(LOG_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  fs.writeFileSync(logFile, log.dump(), 'utf8');

  if (failed.length === 0) {
    const body =
      `✅ <b>Avatar OK — ${escapeHtml(avatar.name)}</b>\n` +
      `${passed.length}/${results.length} workflows passed in ${durationS}s\n` +
      `🕒 ${ts()}\n\n` +
      results.map((r) => `• ✅ ${escapeHtml(r.name)}`).join('\n');
    await sendMessage(body);
  } else {
    const isDown = failed.some((f) => /status|Navigation/i.test(f.error || ''));
    const title = isDown ? '🌐 AVATAR DOWN / UNREACHABLE' : '⚠️ AVATAR FUNCTION FAILING';
    const body =
      `🚨 <b>${title} — ${escapeHtml(avatar.name)}</b>\n` +
      `<b>Take immediate action.</b>\n\n` +
      `${failed.length}/${results.length} workflows FAILED (${durationS}s)\n` +
      `🕒 ${ts()}\n\n` +
      `<b>Failures</b>\n` +
      failed.map((f) => `• ❌ ${escapeHtml(f.name)}\n   ↳ ${escapeHtml((f.error || '').slice(0, 200))}`).join('\n') +
      (passed.length ? `\n\n<b>Still passing</b>\n` + passed.map((p) => `• ✅ ${escapeHtml(p.name)}`).join('\n') : '');
    await sendMessage(body);
    await sendDocument(logFile, `Full log — ${avatar.name}`);
    for (const shot of base.screenshots.slice(0, 3)) await sendPhoto(shot, path.basename(shot));
  }

  console.log(`Done. ${passed.length}/${results.length} passed. Log: ${logFile}`);
  process.exit(failed.length ? 1 : 0); // non-zero marks the CI run red too
}

main().catch(async (e) => {
  console.error('Fatal runner error', e);
  try { await sendMessage(`🚨 <b>Regression runner crashed</b>\n${escapeHtml(String(e.message).slice(0, 300))}`); } catch (_) {}
  process.exit(1);
});
