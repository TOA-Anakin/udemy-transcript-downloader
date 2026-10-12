// src/auth.js
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Launch browser, complete login, extract cookies, close browser.
 * @param {{ email: string, isEnterprise: boolean, udemyBase: string, rl: import('readline').Interface }} opts
 * @returns {Promise<string>} Cookie header string for use in HTTP requests
 */
async function loginAndGetCookies({ email, isEnterprise, udemyBase, rl }) {

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

    // Navigate to udemy home to ensure cookies are fully set
    await page.goto(`${udemyBase}/`, { waitUntil: 'domcontentloaded' });

    const cookies = await page.cookies();
    // Build Cookie header value — never log the values
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    return cookieHeader;
  } finally {
    await browser.close();
  }
}

/**
 * Extract course ID by fetching course page HTML and finding data-clp-course-id attribute.
 * Browser is already closed; uses node:https with the cookie header.
 */
async function extractCourseId(courseUrl, cookieHeader) {
  const https = require('node:https');
  const http = require('node:http');

  function fetchFollowRedirects(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, {
        headers: {
          Cookie: cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
          const next = new URL(res.headers.location, url).href;
          res.resume();
          return fetchFollowRedirects(next, maxRedirects - 1).then(resolve, reject);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('Timeout fetching course page')));
    });
  }

  const { status, html } = await fetchFollowRedirects(courseUrl);

  const match = html.match(/data-clp-course-id="(\d+)"/);
  if (match) return match[1];
  const metaMatch = html.match(/"courseId"\s*:\s*"?(\d+)"?/);
  if (metaMatch) return metaMatch[1];
  // Extra pattern for Udemy's server-side data blob
  const udMatch = html.match(/"id"\s*:\s*(\d{5,})/);
  if (udMatch) return udMatch[1];
  // Course ID appears in the course image CDN URL (always present in SSR HTML)
  // e.g. /course/480x270/6367439_e989_2.jpg
  const imgMatch = html.match(/\/course\/\d+x\d+\/(\d+)[_/.]/);
  if (imgMatch) return imgMatch[1];

  // Dump debug info so the user can see what the page actually returned
  console.error(`\n[debug] HTTP ${status} for ${courseUrl}`);
  console.error('[debug] HTML snippet (first 2000 chars):\n' + html.slice(0, 2000));
  throw new Error('Could not extract course ID from course page. Ensure you are enrolled.');
}

module.exports = { loginAndGetCookies, extractCourseId };
