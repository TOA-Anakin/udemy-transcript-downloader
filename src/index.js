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

  try {
    const startFrom = await new Promise(resolve =>
      rl.question('Start from which lecture index? (default 1) [1]: ', ans => {
        resolve(ans.trim() ? parseInt(ans.trim(), 10) : 1);
      })
    );

    console.log('Launching browser for login...');
    const cookieHeader = await loginAndGetCookies({ email, isEnterprise, udemyBase, rl });
    console.log('Browser closed. Fetching course data...');

    const courseId = await extractCourseId(courseUrl, cookieHeader);
    console.log(`Course ID: ${courseId}`);

    const lectureList = await fetchCurriculum(udemyBase, courseId, cookieHeader);
    console.log(`Found ${lectureList.length} video lectures.`);

    // Filter by startFrom (flat position in full lecture list)
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
  } finally {
    rl.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
