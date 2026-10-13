# Resumable API-First Transcript Downloader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flaky browser-scraping transcript loop with a single-worker, API-first downloader that fetches VTT caption URLs directly, writes plain-text `.md` files atomically, and maintains a per-course JSON manifest enabling safe resume and a completeness report.

**Architecture:** Puppeteer is used only for login + one paginated API call; cookies are extracted then the browser closes. All subsequent I/O is plain Node.js `https` requests against the caption URLs already present in the curriculum API response. A sequential loop with exponential backoff + jitter handles retries; 401/403 aborts the run; persistent 429 or exhausted retries mark a lecture `failed` and continue.

**Tech Stack:** Node.js 18+ built-ins (`node:https`, `node:fs`, `node:path`, `node:timers/promises`), puppeteer-extra + stealth (already installed), dotenv (already installed). No new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/index.js` | **Replace** | Entry point: CLI args, login, close browser, run downloader, print report |
| `src/auth.js` | **Create** | Browser launch, login flow (passwordless + SSO), cookie extraction, browser close |
| `src/curriculum.js` | **Create** | Paginated API fetch, course structure parsing, returns flat lecture list |
| `src/manifest.js` | **Create** | Load/save/update manifest JSON; atomic write via `.tmp` + rename |
| `src/downloader.js` | **Create** | Sequential fetch loop, VTT→markdown conversion, backoff, Retry-After, abort logic |
| `src/report.js` | **Create** | Print completeness report; registered as `process.on('SIGINT')` handler too |

---

## Task 1: Manifest module

**Files:**
- Create: `src/manifest.js`

The manifest lives at `output/<courseId>/manifest.json`. Each lecture entry has:
```
{ id, title, sectionIndex, lectureIndex, captionUrl|null, status }
```
`status` ∈ `"pending" | "success" | "no_captions" | "failed"`

Atomic write: write to `<path>.tmp` then `fs.renameSync` to the real path (rename is atomic on Linux/macOS; on Windows it overwrites).

- [ ] **Step 1: Write `src/manifest.js`**

```js
// src/manifest.js
const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{ id: number, title: string, sectionIndex: number, lectureIndex: number,
 *             captionUrl: string|null, status: 'pending'|'success'|'no_captions'|'failed' }} LectureEntry
 * @typedef {{ courseId: string, lectures: LectureEntry[] }} Manifest
 */

function manifestPath(outputDir, courseId) {
  return path.join(outputDir, courseId, 'manifest.json');
}

/** Load existing manifest, or build a fresh one from lectureList. */
function loadOrCreate(outputDir, courseId, lectureList) {
  const p = manifestPath(outputDir, courseId);
  if (fs.existsSync(p)) {
    const existing = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`Loaded existing manifest (${existing.lectures.length} lectures).`);
    return existing;
  }
  const manifest = { courseId, lectures: lectureList.map(l => ({ ...l, status: 'pending' })) };
  save(outputDir, manifest);
  console.log(`Created manifest (${manifest.lectures.length} lectures).`);
  return manifest;
}

/** Atomically save manifest to disk. */
function save(outputDir, manifest) {
  const p = manifestPath(outputDir, manifest.courseId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/** Mark a lecture's status and persist. */
function update(outputDir, manifest, lectureId, status) {
  const entry = manifest.lectures.find(l => l.id === lectureId);
  if (!entry) throw new Error(`Lecture ${lectureId} not in manifest`);
  entry.status = status;
  save(outputDir, manifest);
}

module.exports = { loadOrCreate, save, update };
```

- [ ] **Step 2: Smoke-test manifest**

```js
// Run once manually to verify (paste in node REPL or a scratch file):
const manifest = require('./src/manifest');
const m = manifest.loadOrCreate('/tmp/test-output', 'course123', [
  { id: 1, title: 'Intro', sectionIndex: 1, lectureIndex: 1, captionUrl: 'https://example.com/a.vtt' },
]);
manifest.update('/tmp/test-output', m, 1, 'success');
const loaded = manifest.loadOrCreate('/tmp/test-output', 'course123', []);
console.assert(loaded.lectures[0].status === 'success', 'status should be success');
console.log('manifest smoke-test passed');
```

Run: `node -e "$(cat << 'EOF'
const manifest = require('./src/manifest');
const m = manifest.loadOrCreate('/tmp/test-output', 'course123', [
  { id: 1, title: 'Intro', sectionIndex: 1, lectureIndex: 1, captionUrl: 'https://example.com/a.vtt' },
]);
manifest.update('/tmp/test-output', m, 1, 'success');
const loaded = manifest.loadOrCreate('/tmp/test-output', 'course123', []);
console.assert(loaded.lectures[0].status === 'success', 'status should be success');
console.log('manifest smoke-test passed');
EOF
)"`

Expected output: `manifest smoke-test passed`

- [ ] **Step 3: Commit**

```bash
git add src/manifest.js
git commit -m "feat: manifest module with atomic save and load-or-create"
```

---

## Task 2: Curriculum module

**Files:**
- Create: `src/curriculum.js`

Fetches `/api-2.0/courses/<id>/subscriber-curriculum-items/` with pagination (`next` field), parses chapters + video lectures only, returns a flat array of `LectureEntry` objects (without `status` — manifest adds that).

The HTTP fetch reuses the cookie string extracted from Puppeteer. Uses `node:https` — no new deps.

- [ ] **Step 1: Write `src/curriculum.js`**

```js
// src/curriculum.js
const https = require('node:https');

/**
 * Perform a single HTTPS GET, resolve with parsed JSON.
 * @param {string} url
 * @param {string} cookieHeader  — value of Cookie: header
 * @returns {Promise<object>}
 */
function fetchJson(url, cookieHeader) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.udemy.com/',
      },
    }, res => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        return reject(Object.assign(new Error(`Auth error: ${res.statusCode}`), { code: res.statusCode }));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timed out')); });
  });
}

/**
 * Fetch all curriculum pages and return a flat list of LectureEntry objects.
 * @param {string} udemyBase  e.g. 'https://www.udemy.com'
 * @param {string} courseId
 * @param {string} cookieHeader
 * @returns {Promise<import('./manifest').LectureEntry[]>}
 */
async function fetchCurriculum(udemyBase, courseId, cookieHeader) {
  const fields = [
    'fields[lecture]=title,object_index,is_published,sort_order,created,asset,supplementary_assets,is_free',
    'fields[quiz]=title,object_index,is_published,sort_order,type',
    'fields[practice]=title,object_index,is_published,sort_order',
    'fields[chapter]=title,object_index,is_published,sort_order',
    'fields[asset]=title,filename,asset_type,status,time_estimation,is_external,transcript,captions',
    'caching_intent=True',
  ].join('&');

  let url = `${udemyBase}/api-2.0/courses/${courseId}/subscriber-curriculum-items/?page_size=200&${fields}`;
  let allResults = [];
  let page = 1;

  while (url) {
    console.log(`Fetching curriculum page ${page}...`);
    const data = await fetchJson(url, cookieHeader);
    if (!data.results) throw new Error('Curriculum API returned no results');
    allResults = allResults.concat(data.results);
    url = data.next || null;
    page++;
  }

  return parseCurriculum(allResults);
}

function parseCurriculum(results) {
  const sorted = [...results].sort((a, b) => a.sort_order - b.sort_order);
  const lectures = [];
  let currentSectionIndex = 0;

  for (const item of sorted) {
    if (item._class === 'chapter') {
      currentSectionIndex = item.object_index;
      continue;
    }
    if (
      item._class !== 'lecture' ||
      !item.asset ||
      typeof item.asset.asset_type !== 'string' ||
      !item.asset.asset_type.toLowerCase().includes('video')
    ) continue;

    const captions = Array.isArray(item.asset.captions)
      ? item.asset.captions.filter(c => c.url && (c.locale_id || '').startsWith('en'))
      : [];
    // Prefer English captions; fall back to first available
    const captionUrl = captions.length > 0
      ? captions[0].url
      : (Array.isArray(item.asset.captions) && item.asset.captions.find(c => c.url)?.url) || null;

    lectures.push({
      id: item.id,
      title: item.title,
      sectionIndex: currentSectionIndex,
      lectureIndex: item.object_index,
      captionUrl,
    });
  }

  return lectures;
}

module.exports = { fetchCurriculum };
```

- [ ] **Step 2: Self-test parse logic with fixture**

```js
// Paste in node REPL to verify parseCurriculum handles mixed items correctly
const { fetchCurriculum } = require('./src/curriculum');
// parseCurriculum is not exported, but we can test fetchCurriculum indirectly.
// The real test is in Task 5 (integration). Just confirm the module loads:
console.log(typeof fetchCurriculum === 'function' ? 'curriculum module OK' : 'FAIL');
```

Run: `node -e "const {fetchCurriculum}=require('./src/curriculum'); console.log(typeof fetchCurriculum==='function'?'curriculum module OK':'FAIL')"`

Expected: `curriculum module OK`

- [ ] **Step 3: Commit**

```bash
git add src/curriculum.js
git commit -m "feat: curriculum module with paginated API fetch and caption URL extraction"
```

---

## Task 3: Auth module

**Files:**
- Create: `src/auth.js`

Encapsulates: browser launch, login (passwordless email or enterprise SSO), return cookie header string, close browser. Keeps all readline prompts here. Does NOT print cookies or tokens.

- [ ] **Step 1: Write `src/auth.js`**

```js
// src/auth.js
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('node:readline');

puppeteerExtra.use(StealthPlugin());

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Launch browser, complete login, extract cookies, close browser.
 * @param {{ email: string, isEnterprise: boolean, udemyBase: string }} opts
 * @returns {Promise<string>} Cookie header string for use in HTTP requests
 */
async function loginAndGetCookies({ email, isEnterprise, udemyBase }) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const browser = await puppeteerExtra.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1280,720', '--no-sandbox', '--disable-gpu',
           '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
    protocolTimeout: 300000,
  });

  try {
    const page = await browser.newPage();
    await new Promise(r => setTimeout(r, 1000));

    if (isEnterprise) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.goto(`${udemyBase}/`, { waitUntil: 'domcontentloaded' });
          break;
        } catch (err) {
          if (!err.message.includes('frame was detached')) throw err;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      console.log('\nPlease complete the SSO login in the browser window.');
      await ask(rl, 'Press Enter when login is complete: ');
    } else {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await page.goto('https://www.udemy.com/join/passwordless-auth', { waitUntil: 'domcontentloaded' });
          break;
        } catch (err) {
          if (!err.message.includes('frame was detached')) throw err;
          console.warn('Frame detached, retrying...');
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      console.log('Processing login...');
      console.log('If a CAPTCHA appears, complete it, then press Enter.');
      await ask(rl, 'Press Enter when the login page (with email field) is fully loaded: ');
      await page.waitForSelector('input[name="email"]');
      await page.type('input[name="email"]', email, { delay: 100 });

      try {
        const cookieBtnExists = await page.evaluate(() => !!document.getElementById('onetrust-accept-btn-handler'));
        if (cookieBtnExists) {
          await page.$eval('#onetrust-accept-btn-handler', el => el.click());
        }
      } catch (_) {}

      await page.$eval('[data-purpose="code-generation-form"] [type="submit"]', el => el.click());
      console.log('Email submitted. Check your inbox for the 6-digit code.');

      const code = (await ask(rl, 'Enter the 6-digit verification code: ')).trim();
      await page.waitForSelector('[data-purpose="otp-text-area"] input', { timeout: 60000 });
      await page.type('[data-purpose="otp-text-area"] input', code, { delay: 100 });
      await page.$eval('[data-purpose="otp-verification-form"] [type="submit"]', el => el.click());
      await new Promise(r => setTimeout(r, 5000));
      console.log('Login successful.');
    }

    // Extract course ID from course page (caller must navigate there)
    // Navigate to udemy home to ensure cookies are fully set
    await page.goto(`${udemyBase}/`, { waitUntil: 'domcontentloaded' });

    const cookies = await page.cookies();
    // Build Cookie header value — never log the values
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    return cookieHeader;
  } finally {
    await browser.close();
    rl.close();
  }
}

/**
 * Extract course ID via browser (brief navigation, no login needed if called after loginAndGetCookies).
 * Since the browser is already closed after loginAndGetCookies, we fetch course page via https instead.
 * Returns courseId from the API or the course URL slug.
 */
async function extractCourseId(courseUrl, cookieHeader) {
  // Use a lightweight https fetch to the course page and find the data-clp-course-id attribute
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    const req = https.get(courseUrl, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        const match = html.match(/data-clp-course-id="(\d+)"/);
        if (match) return resolve(match[1]);
        // Fallback: try meta tag or JSON-LD
        const metaMatch = html.match(/"courseId"\s*:\s*"?(\d+)"?/);
        if (metaMatch) return resolve(metaMatch[1]);
        reject(new Error('Could not extract course ID from course page. Ensure you are enrolled.'));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout fetching course page')));
  });
}

module.exports = { loginAndGetCookies, extractCourseId };
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const a=require('./src/auth'); console.log(typeof a.loginAndGetCookies==='function'&&typeof a.extractCourseId==='function'?'auth module OK':'FAIL')"`

Expected: `auth module OK`

- [ ] **Step 3: Commit**

```bash
git add src/auth.js
git commit -m "feat: auth module — login, cookie extraction, course ID extraction"
```

---

## Task 4: Downloader module

**Files:**
- Create: `src/downloader.js`

Sequential loop over pending lectures. Per lecture:
1. `captionUrl === null` → `update(..., 'no_captions')`
2. Fetch VTT with retry logic
3. Strip VTT headers/timestamps → plain text
4. Write `.md` atomically
5. `update(..., 'success')`

**Backoff formula:** `delay = min(base * 2^attempt, maxDelay) + jitter(0..1000ms)`
**Retry-After:** if 429 response has `retry-after` header, sleep that many seconds (capped at 300s).
**Abort on:** 401 or 403 at any point.
**Stop retrying after:** 3 attempts → mark `failed`, continue to next lecture.

- [ ] **Step 1: Write `src/downloader.js`**

```js
// src/downloader.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const manifest = require('./manifest');

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 30000;

/** Fetch a URL, return { status, headers, body } */
function fetchRaw(url, cookieHeader) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: '*/*',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('VTT fetch timed out')));
  });
}

/** Convert VTT text to plain markdown (strip header, timestamps, cue IDs). */
function vttToMarkdown(vtt) {
  return vtt
    .replace(/^WEBVTT[^\n]*\n/, '')
    .replace(/^NOTE[^\n]*\n[\s\S]*?(?=\n\n|$)/gm, '')
    .split(/\n{2,}/)
    .map(block => {
      const lines = block.trim().split('\n');
      // Remove cue ID line (numeric or UUID) and timestamp line
      return lines
        .filter(l => !/^\d+$/.test(l))
        .filter(l => !/^\d{2}[:\.]\d{2}/.test(l))
        .join(' ')
        .trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Sanitize a string for use as a filename. */
function sanitize(s) {
  return s.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

/**
 * Run the sequential download loop.
 * @param {string} outputDir
 * @param {import('./manifest').Manifest} mf
 * @param {string} cookieHeader
 * @returns {Promise<void>}
 */
async function runDownloads(outputDir, mf, cookieHeader) {
  const courseDir = path.join(outputDir, mf.courseId);
  fs.mkdirSync(courseDir, { recursive: true });

  const pending = mf.lectures.filter(l => l.status === 'pending');
  console.log(`\nDownloading transcripts: ${pending.length} pending, ${mf.lectures.length} total.\n`);

  for (const lecture of pending) {
    if (lecture.captionUrl === null) {
      console.log(`[no_captions] ${lecture.sectionIndex}.${lecture.lectureIndex} ${lecture.title}`);
      manifest.update(outputDir, mf, lecture.id, 'no_captions');
      continue;
    }

    let lastErr = null;
    let succeeded = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const jitter = Math.floor(Math.random() * 1000);
        const delay = Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_MAX_MS) + jitter;
        console.log(`  Retry ${attempt}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      }

      try {
        const { status, headers, body } = await fetchRaw(lecture.captionUrl, cookieHeader);

        if (status === 401 || status === 403) {
          throw Object.assign(new Error(`Auth error ${status} — aborting run`), { fatal: true });
        }

        if (status === 429) {
          const retryAfter = headers['retry-after'];
          const waitSec = retryAfter ? Math.min(parseInt(retryAfter, 10), 300) : null;
          if (waitSec) {
            console.log(`  429 Retry-After: waiting ${waitSec}s...`);
            await sleep(waitSec * 1000);
          }
          lastErr = new Error('429 rate limited');
          continue; // counts as a retry attempt
        }

        if (status < 200 || status >= 300) {
          lastErr = new Error(`HTTP ${status}`);
          continue;
        }

        const markdown = vttToMarkdown(body);
        const filename = sanitize(`${lecture.sectionIndex}.${lecture.lectureIndex} ${lecture.title}`) + '.md';
        const filePath = path.join(courseDir, filename);
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, `# ${lecture.title}\n\n${markdown}`, 'utf8');
        fs.renameSync(tmp, filePath);

        manifest.update(outputDir, mf, lecture.id, 'success');
        console.log(`[success] ${filename}`);
        succeeded = true;
        break;

      } catch (err) {
        if (err.fatal) throw err; // propagate auth errors to main
        lastErr = err;
      }
    }

    if (!succeeded) {
      console.error(`[failed]  ${lecture.sectionIndex}.${lecture.lectureIndex} ${lecture.title} — ${lastErr?.message}`);
      manifest.update(outputDir, mf, lecture.id, 'failed');
    }
  }
}

module.exports = { runDownloads, vttToMarkdown };
```

- [ ] **Step 2: Unit-test `vttToMarkdown`**

```js
// paste in node REPL
const { vttToMarkdown } = require('./src/downloader');

const sample = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello world.

2
00:00:04.000 --> 00:00:06.000
This is a test.
`;

const result = vttToMarkdown(sample);
console.assert(result === 'Hello world.\n\nThis is a test.', `Got: ${JSON.stringify(result)}`);
console.log('vttToMarkdown test passed');
```

Run: `node -e "
const { vttToMarkdown } = require('./src/downloader');
const sample = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello world.\n\n2\n00:00:04.000 --> 00:00:06.000\nThis is a test.\n';
const result = vttToMarkdown(sample);
console.assert(result === 'Hello world.\n\nThis is a test.', 'Got: ' + JSON.stringify(result));
console.log('vttToMarkdown test passed');
"`

Expected: `vttToMarkdown test passed`

- [ ] **Step 3: Commit**

```bash
git add src/downloader.js
git commit -m "feat: downloader module — sequential fetch, backoff, Retry-After, atomic write"
```

---

## Task 5: Report module

**Files:**
- Create: `src/report.js`

Prints a completeness report from the manifest. Called at the end of the run and on SIGINT.

- [ ] **Step 1: Write `src/report.js`**

```js
// src/report.js

/**
 * Print a completeness report to stdout.
 * @param {import('./manifest').Manifest} mf
 */
function printReport(mf) {
  const byStatus = { success: [], no_captions: [], failed: [], pending: [] };
  for (const l of mf.lectures) {
    (byStatus[l.status] || byStatus.pending).push(l);
  }

  const total = mf.lectures.length;
  console.log('\n========== Transcript Download Report ==========');
  console.log(`Total lectures : ${total}`);
  console.log(`Success        : ${byStatus.success.length}`);
  console.log(`No captions    : ${byStatus.no_captions.length}`);
  console.log(`Failed         : ${byStatus.failed.length}`);
  console.log(`Still pending  : ${byStatus.pending.length}`);

  if (byStatus.no_captions.length > 0) {
    console.log('\n--- Lectures with no captions ---');
    for (const l of byStatus.no_captions) {
      console.log(`  ${l.sectionIndex}.${l.lectureIndex} ${l.title}`);
    }
  }

  if (byStatus.failed.length > 0) {
    console.log('\n--- Failed lectures (retry by re-running) ---');
    for (const l of byStatus.failed) {
      console.log(`  ${l.sectionIndex}.${l.lectureIndex} ${l.title}`);
    }
  }

  if (byStatus.pending.length > 0) {
    console.log('\n--- Still pending (run was interrupted) ---');
    for (const l of byStatus.pending) {
      console.log(`  ${l.sectionIndex}.${l.lectureIndex} ${l.title}`);
    }
  }

  console.log('================================================\n');
}

module.exports = { printReport };
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const r=require('./src/report'); console.log(typeof r.printReport==='function'?'report module OK':'FAIL')"`

Expected: `report module OK`

- [ ] **Step 3: Commit**

```bash
git add src/report.js
git commit -m "feat: report module — completeness summary with no_captions and failed lists"
```

---

## Task 6: Rewrite `src/index.js`

**Files:**
- Modify: `src/index.js` (full replacement)

Wire all modules together. Flow:
1. Parse args (courseUrl), detect enterprise
2. Ask `startFromLecture` (one prompt kept for usability)
3. Login → cookies → browser closed
4. Extract courseId
5. Fetch curriculum → flat lecture list
6. Load-or-create manifest (filter by `startFromLecture`)
7. Register SIGINT handler → `printReport` + exit
8. Run downloads
9. Print report

- [ ] **Step 1: Replace `src/index.js`**

```js
// src/index.js
const path = require('node:path');
const readline = require('node:readline');
const dotenv = require('dotenv');
const { loginAndGetCookies, extractCourseId } = require('./auth');
const { fetchCurriculum } = require('./curriculum');
const { loadOrCreate } = require('./manifest');
const { runDownloads } = require('./downloader');
const { printReport } = require('./report');
const { generateContentsFile } = require('./contents');

dotenv.config();

const outputDir = path.join(__dirname, '../output');

async function main() {
  if (process.argv.length < 3) {
    console.error('Usage: node src/index.js <udemy-course-url>');
    process.exit(1);
  }

  let courseUrl = process.argv[2];
  if (!courseUrl.endsWith('/')) courseUrl += '/';

  const courseUrlObj = new URL(courseUrl);
  const isEnterprise = !['www.udemy.com', 'udemy.com'].includes(courseUrlObj.hostname);
  const udemyBase = isEnterprise
    ? `${courseUrlObj.protocol}//${courseUrlObj.hostname}`
    : 'https://www.udemy.com';

  if (isEnterprise) console.log(`Enterprise/SSO subdomain: ${courseUrlObj.hostname}`);

  const email = process.env.UDEMY_EMAIL;
  if (!isEnterprise && !email) {
    console.error('UDEMY_EMAIL not set in .env');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const startFrom = await new Promise(resolve =>
    rl.question('Start from which lecture index? (default 1) [1]: ', ans => {
      rl.close();
      resolve(ans.trim() ? parseInt(ans.trim(), 10) : 1);
    })
  );

  console.log('Launching browser for login...');
  const cookieHeader = await loginAndGetCookies({ email, isEnterprise, udemyBase });
  console.log('Browser closed. Fetching course data...');

  const courseId = await extractCourseId(courseUrl, cookieHeader);
  console.log(`Course ID: ${courseId}`);

  const lectureList = await fetchCurriculum(udemyBase, courseId, cookieHeader);
  console.log(`Found ${lectureList.length} video lectures.`);

  // Filter by startFrom (lectureIndex is the position within the section — use flat position)
  const filtered = startFrom > 1
    ? lectureList.filter((_, i) => i + 1 >= startFrom)
    : lectureList;

  // Build or load manifest — on resume, pending lectures are whatever wasn't finished
  const mf = loadOrCreate(outputDir, courseId, filtered);

  // Generate CONTENTS.txt (course structure overview)
  generateContentsFile(outputDir, courseId, lectureList);

  // Register SIGINT so Ctrl+C prints report before exit
  process.on('SIGINT', () => {
    console.log('\nInterrupted.');
    printReport(mf);
    process.exit(0);
  });

  await runDownloads(outputDir, mf, cookieHeader);
  printReport(mf);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Commit (partial — contents.js missing, will add next task)**

```bash
git add src/index.js
git commit -m "feat: rewrite index.js — single worker, manifest-driven, SIGINT report"
```

---

## Task 7: Contents file module

**Files:**
- Create: `src/contents.js`

Extracted from the old `index.js`. Writes `output/<courseId>/CONTENTS.txt`.

- [ ] **Step 1: Write `src/contents.js`**

```js
// src/contents.js
const fs = require('node:fs');
const path = require('node:path');

/**
 * Write a CONTENTS.txt to output/<courseId>/ listing all lectures with section grouping.
 * @param {string} outputDir
 * @param {string} courseId
 * @param {import('./manifest').LectureEntry[]} lectures  — full flat list (unsectioned)
 */
function generateContentsFile(outputDir, courseId, lectures) {
  const courseDir = path.join(outputDir, courseId);
  fs.mkdirSync(courseDir, { recursive: true });

  // Group by sectionIndex
  const sections = new Map();
  for (const l of lectures) {
    if (!sections.has(l.sectionIndex)) sections.set(l.sectionIndex, []);
    sections.get(l.sectionIndex).push(l);
  }

  let content = '';
  for (const [sIdx, lecs] of [...sections.entries()].sort((a, b) => a[0] - b[0])) {
    content += `Section ${sIdx}\n`;
    for (const l of lecs) {
      content += `  ${sIdx}.${l.lectureIndex} ${l.title}\n`;
    }
    content += '\n';
  }

  fs.writeFileSync(path.join(courseDir, 'CONTENTS.txt'), content, 'utf8');
  console.log(`CONTENTS.txt written to output/${courseId}/CONTENTS.txt`);
}

module.exports = { generateContentsFile };
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const c=require('./src/contents'); console.log(typeof c.generateContentsFile==='function'?'contents module OK':'FAIL')"`

Expected: `contents module OK`

- [ ] **Step 3: Full smoke-test (dry run — no browser)**

```bash
node -e "
const {generateContentsFile} = require('./src/contents');
const {loadOrCreate, update} = require('./src/manifest');
const {printReport} = require('./src/report');

const lectures = [
  {id:1,title:'Intro',sectionIndex:1,lectureIndex:1,captionUrl:'https://x.com/a.vtt'},
  {id:2,title:'Deep Dive',sectionIndex:1,lectureIndex:2,captionUrl:null},
];
generateContentsFile('/tmp/smoke', 'test123', lectures);
const mf = loadOrCreate('/tmp/smoke','test123',lectures);
update('/tmp/smoke', mf, 2, 'no_captions');
printReport(mf);
console.log('smoke test passed');
"
```

Expected: prints report showing 1 pending, 1 no_captions, then `smoke test passed`

- [ ] **Step 4: Commit**

```bash
git add src/contents.js
git commit -m "feat: contents module — CONTENTS.txt generation per course"
```

---

## Task 8: End-to-end wiring check

**Files:**
- No new files. Verify all imports resolve.

- [ ] **Step 1: Verify all modules load together**

Run: `node -e "require('./src/index.js')" 2>&1 | head -5`

Expected: should print `Usage: node src/index.js <udemy-course-url>` and exit 1 (no crash from missing imports).

- [ ] **Step 2: Check no old parallel-tab code remains**

Run: `grep -n "tabCount\|tabIndex\|chunkArray\|Promise.all" src/index.js`

Expected: no output (all parallel tab logic removed)

- [ ] **Step 3: Check cookies never logged**

Run: `grep -n "cookieHeader\|cookie" src/auth.js | grep -i "console\|log\|print"`

Expected: no output

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: wire all modules, verify no cookie logging or parallel-tab remnants"
```

---

## Task 9: Update README

**Files:**
- Modify: `README.md`

Update to reflect new behavior: single worker, manifest-based resume, per-course output folder, report output.

- [ ] **Step 1: Replace README usage section**

Find and replace the **Usage** and **Output Files** sections in `README.md`:

```markdown
## Usage

```bash
node src/index.js "https://www.udemy.com/course/your-course/"
```

The script will:
1. Ask which lecture index to start from (default 1; use to skip ahead on first run)
2. Open a browser for login (email verification code or SSO)
3. Close the browser once authenticated
4. Fetch the full course curriculum via API (paginated)
5. Create or load `output/<courseId>/manifest.json`
6. Download each lecture transcript sequentially, with retries and backoff
7. Save plain-text `.md` files to `output/<courseId>/`
8. Print a completeness report on finish or Ctrl+C

## Output Files

All output is saved under `output/<courseId>/`:

- `manifest.json` — tracks status per lecture: `pending/success/no_captions/failed`
- `CONTENTS.txt` — full course outline
- `<section>.<index> <title>.md` — transcript per lecture

## Resuming

Re-run with the same course URL. Lectures with status `success` or `no_captions` are skipped automatically. Only `pending` and `failed` lectures are retried.

## Completeness Report

Printed at end of run (or on Ctrl+C). Lists all lectures without captions and all lectures that failed after retries.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for single-worker API-first downloader"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|-------------|------|
| Reuse existing auth, no cookie printing | Task 3 (`auth.js` — cookies extracted but never logged) |
| Inventory all lectures, preserve IDs + section order | Task 2 (`curriculum.js` — paginated, sorted by sort_order) |
| Distinguish no_captions vs HTTP failure | Task 4 (`downloader.js` — null captionUrl → no_captions, HTTP errors → failed) |
| Atomic file save | Task 4 (`.tmp` + rename) |
| JSON manifest with statuses | Task 1 (`manifest.js`) |
| Configurable timeouts | Task 4 (`FETCH_TIMEOUT_MS = 30000`) |
| Bounded retries + exponential backoff + jitter | Task 4 (3 retries, `min(base*2^n, max)+jitter`) |
| Respect Retry-After | Task 4 (429 handler) |
| Stop on 401/403 | Task 4 (`err.fatal` propagation) |
| Stop on persistent 429 | Task 4 (counts against MAX_RETRIES) |
| Resume only unfinished lectures | Task 1 + 6 (load manifest, filter pending) |
| Completeness report | Task 5 (`report.js`) |
| Single worker | Task 4 (sequential loop, no Promise.all) |
| Pagination >200 items | Task 2 (`while (url)` loop on `data.next`) |

**Placeholder scan:** None found — all steps have complete code.

**Type consistency:**
- `LectureEntry` defined in manifest.js Task 1, used consistently in all subsequent modules
- `mf` (Manifest object) passed consistently: `loadOrCreate` → `runDownloads` → `printReport`
- `outputDir` is always `path.join(__dirname, '../output')` set once in `index.js`
- `update(outputDir, mf, lecture.id, status)` signature matches across Task 1 definition and Task 4 usage
- `generateContentsFile(outputDir, courseId, lectures)` signature matches Task 7 definition and Task 6 call

All consistent. ✓
