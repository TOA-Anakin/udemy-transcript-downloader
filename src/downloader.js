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
