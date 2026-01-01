  const puppeteer = require('puppeteer');
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const fs = require('fs');
  const path = require('path');
  const readline = require('readline');
  const dotenv = require('dotenv');
  const { log } = require('console');
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 3000; // 3 seconds between retries
  const CHAPTER_PREFIX_REGEX = /chương\s+\d+:\s*/i; // Regex to detect a chapter prefix like "Chương 1709:" (case-insensitive)
  // Load environment variables
  dotenv.config();

  // Apply stealth plugin to avoid detection
  puppeteerExtra.use(StealthPlugin());

  // Initialize readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Create output directory if it doesn't exist
  const outputDir = path.join(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Main function
  async function main() {
    // Check if URL is provided
    if (process.argv.length < 3) {
      console.error('Please provide a course or book URL as a parameter');
      console.error('Example: node metruyenchu.js https://metruyencv.com/truyen/<book-name>');
      process.exit(1);
    }

    // Get course URL from command line argument
    let bookUrl = process.argv[2];

    // Make sure URL ends with a trailing slash
    if (!bookUrl.endsWith('/')) {
      bookUrl += '/';
    }

    console.log(`Course URL: ${bookUrl}`);

    const starter = await new Promise((resolve) => {
      rl.question(`Starting index (default is 0) [0]: `, (answer) => {
        const normalized = answer.trim();
        resolve(normalized ? parseInt(normalized, 10) : 0);
      });
    });

    const tabCount = await new Promise((resolve) => {
      rl.question(`How many tabs do you want to use for downloading transcripts? (default is 5) [5]: `, (answer) => {
        const normalized = answer.trim();
        resolve(normalized ? parseInt(normalized, 10) : 5);
      });
    });

    // Launch browser in headless mode
    console.log('Launching browser...');
    const browser = await puppeteerExtra.launch({
      headless: 'false', // Use the new headless mode
      defaultViewport: null,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', // Path to Edge browser
      userDataDir: 'C:\\Users\\tmhun\\AppData\\Local\\Microsoft\\Edge\\User Data',
      // userDataDir: 'F:\\data\\User Data', // Path to your Edge user profile  
      args: [
        '--window-size=1280,720',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox'
      ],
      dumpio: false, // Enable browser logs
      protocolTimeout: 300000
    });

    try {
      const page = await browser.newPage();
      await new Promise(resolve => setTimeout(resolve, 1000));

      const maxAttempts = 3;
      let chapterLinks = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`Attempt ${attempt} to fetch chapter content...`);
        try {
          // Navigate to table of content link
          console.log(`Navigating to table of content: ${bookUrl}`);
          await page.goto(bookUrl, { waitUntil: 'networkidle2' });

          // Click the "Mục Lục" button
          await page.waitForSelector('span', { timeout: 10000 }); // Wait for the span element to appear
          const mucLucButton = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll("span")).find(el => el.textContent.trim() === "Mục Lục");
          });
          if (mucLucButton) {
            await mucLucButton.click();
            console.log('Clicked "Mục Lục" button.');
          } else {
            throw new Error('"Mục Lục" button not found.');
          }
      
          
          // Wait for chapter links to load
          await page.waitForSelector("a[data-x-bind='ChapterItem(index)']", { timeout: 10000 });

          
          // Extract all chapter links
          chapterLinks = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll("a[data-x-bind='ChapterItem(index)']").forEach((a) => {
              links.push(a.href);
            });
            return links;
          });

          console.log(`Found ${chapterLinks.length} chapter links.`);
          break;
        } catch (err) {
          console.warn(`[Attempt ${attempt}] Failed to fetch course content: ${err.message}`);
          if (attempt < maxAttempts) {
            console.log('Retrying in 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            throw new Error('Could not retrieve course content. Make sure you have access to this course and try again.');
          }
        }
      }

      // Create output directory if it doesn't exist
      const outputDir = path.join(__dirname, '../output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Download transcripts
      console.log('Downloading transcripts...');
      await downloadContents(browser, chapterLinks, tabCount, starter);

      console.log('All chapters have been downloaded successfully!');
    } catch (error) {
      console.error('Error:', error.message);
    } finally {
      // Close browser
      await browser.close();
      rl.close();
    }

    findMissingChapters(outputDir);
  }


  function extractFirstLine(content) {
    // Split the text by newline characters
    const lines =content.split('\n');

    let firstLine = '';

    // Iterate through lines to find the first one that is not empty after trimming
    for (const line of lines) {
        // Trim the line to check if it contains any visible characters
        const trimmedLine = line.trim();
        
        if (trimmedLine.length > 0) {
            firstLine = trimmedLine;
            break; // Stop after finding the first valid line
        }
    }
    return firstLine.split("<br>")[0];
  }

  /**
   * Converts a blob of HTML text into a parsed title and the remaining content.
   * The title is the text before the first case-insensitive occurence of '<br>'.
   * @param {string} htmlString - The raw HTML content from the file.
   */
  function parseContent(htmlString) {
      // Use a case-insensitive regular expression to find the first '<br>' tag
      // The match includes the tag itself (e.g., '<br>', '<BR>', '<br />')
      let input = htmlString;
      const match = htmlString.match(/<br>/i);

      if (match) {
          // The index of the first character of the matched <br> tag
          const brIndex = match.index;
          // 1. Title is the text from the start up to the <br> tag
          const pageTitle = htmlString.substring(0, brIndex).trim();
          // 2. Content is the text starting immediately after the matched <br> tag
          // match[0].length is the length of the matched tag (e.g., 4 for '<br>')
          const pageContent = htmlString.substring(brIndex + match[0].length).trim();
          return { pageTitle, pageContent };
      } else {
          // If no <br> is found, the whole file content is considered the title, and content is empty
          return { pageTitle: htmlString.trim(), pageContent: '' };
      }
  }

  /**
   * Extracts the chapter number from a given URL.
   * @param {string} url - The URL of the chapter.
   * @returns {string} - The chapter number.
   */
  function extractChapterNumber(url) {
    try {
      // Extract the part of the URL that contains the chapter name/number
      const parts = url.split('/');
      // Assumes the last segment is the chapter slug, e.g., 'chuong-900' or 'chuong-900-ten-chuong'
      const lastSegment = parts[parts.length - 1] || parts[parts.length - 2]; 
      // Find the number at the end of the slug
      const match = lastSegment.match(/(\d+)(?:-|$)/);
      
      if (match && match[1]) {
        // Pad the number with leading zeros for better sorting (e.g., 001, 010, 100)
        return match[1].padStart(4, '0');
      }

      console.warn(`Could not reliably extract chapter number from URL segment: ${lastSegment}. Using 'unknown'.`);
      return 'unknown';
    } catch (error) {
      console.error('Error extracting chapter number:', error.message);
      return 'unknown';
    }
  }

function findMissingChapters(searchDir) {
    // --- Configuration ---
  // Regex to find files named 'chapter_###.html' or 'Chapter_###.html' (case-insensitive).
  const FILENAME_REGEX = /^Chapter_(\d+)\.html$/i;

  console.log("--- Starting Missing Number Check ---");
  console.log(`Searching directory: ${searchDir}`);
  console.log(`Searching files matching pattern: ${FILENAME_REGEX}`);

  // 1. Extract all numbers from the filenames
  let fileNumbers = [];
  try {
      const files = fs.readdirSync(searchDir);
      fileNumbers = files
          .map(file => {
              const match = file.match(FILENAME_REGEX);
              // If it matches, return the captured number (as an integer)
              return match ? parseInt(match[1], 10) : null;
          })
          .filter(num => num !== null); // Filter out non-matching files
  } catch (error) {
      console.error(`Error reading directory '${searchDir}':`, error.message);
      process.exit(1);
  }

  // Check if any numbers were found
  if (fileNumbers.length === 0) {
      console.error(`Error: No numbers found in the filenames in '${searchDir}' matching the pattern.`);
      console.error("Please check the directory path and the file naming convention (e.g., Chapter_900.html).");
      process.exit(1);
  }

  // Sort numbers numerically to easily find min/max
  fileNumbers.sort((a, b) => a - b);

  // 2. Find the minimum and maximum numbers
  const minNum = fileNumbers[0];
  const maxNum = fileNumbers[fileNumbers.length - 1];

  console.log(`Lowest number found: ${minNum}`);
  console.log(`Highest number found: ${maxNum}`);

  // Use a Set for efficient O(1) lookups
  const presentNumbers = new Set(fileNumbers);
  const missingNumbers = [];

  // 3. Iterate from min to max and check for presence
  for (let i = minNum; i <= maxNum; i++) {
      if (!presentNumbers.has(i)) {
          missingNumbers.push(i);
      }
  }

  // 4. Report the results
  console.log("-------------------------------------");
  if (missingNumbers.length === 0) {
      console.log("✅ Success! No missing numbers found in the sequence.");
  } else {
      console.log(`❌ MISSING NUMBERS DETECTED (Total: ${missingNumbers.length}):`);
      // Print numbers separated by a space
      console.log(missingNumbers.join(' '));
  }

  console.log("--- Check Complete ---");
}

  // Function to download contents
async function downloadContents(browser, chapterLinks, tabCount = 5, starter = 0) {
  // Split into chunks
  function chunkArray(arr, chunkCount) {
    const chunks = Array.from({ length: chunkCount }, () => []);
    arr.forEach((item, index) => {
      chunks[index % chunkCount].push(item);
    });
    return chunks;
  }

  const chunks = chunkArray(chapterLinks.slice(starter), tabCount);

  // Launch tabs and process in parallel
  await Promise.all(chunks.map(async (chunk, tabIndex) => {
    const page = await browser.newPage();
    console.log(`Tab ${tabIndex + 1} processing ${chunk.length} lectures...`);

    for (let i = 0; i < chunk.length; i++) {
      const chapterUrl = chunk[i];
      const chapterNumber = extractChapterNumber(chapterUrl);
      const chapterIndex = starter + (tabIndex * chunk.length) + i; // Approximate global index

      // Open chapter page
      const chapterPage = await browser.newPage();
      
      let successfulExtraction = false;
      // Object to hold extracted data, scoped correctly for use after the retry loop.
      // Added pageTitle and pageContent to chapterData for proper scoping.
      let chapterData = { htmlContent: '', pageTitle: '', pageContent: '' };
      
      // --- UPLIFTED RETRY LOOP (Controlled attempts with delay) ---
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await chapterPage.goto(chapterUrl, { waitUntil: 'networkidle2' });
          console.log(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Attempt ${attempt}/${MAX_RETRIES}: Navigated to chapter URL.`);
  
          // Extract raw HTML content
          let { contentHtml } = await chapterPage.evaluate(() => {
            const contentElement = document.querySelector('#chapter-content');
            // Use innerHTML to preserve formatting
            const html = contentElement ? contentElement.innerHTML : '';
            return { contentHtml: html };
          });
        
          // Parse content to split title from body using the <br> separator
          const { pageTitle, pageContent } = parseContent(contentHtml);
          // Store results in the outer-scoped object
          chapterData.htmlContent = contentHtml;  // Store the full HTML content
          chapterData.pageTitle = pageTitle;
          chapterData.pageContent = pageContent;
          
          // Check if the page is likely loaded correctly by testing the title format
          if (CHAPTER_PREFIX_REGEX.test(pageTitle) && pageContent.length > 50) {
            // Success criteria met: prefix found AND content is substantial
            successfulExtraction = true;
            console.log(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Success! Title: "${pageTitle.substring(0, 50)}..."`);
            break; // Exit the retry loop
          } else {
            // Failure criteria: title mismatch or content empty/too small
            console.warn(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Title check failed: "${pageTitle}". Retrying...`);
            if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
          }

        } catch (error) {
          console.error(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Error on attempt ${attempt}: ${error.message}`);
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            // Max retries hit, skip the chapter
            console.error(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Failed to load content after ${MAX_RETRIES} attempts. Skipping chapter.`);
            break;
          }
        }
      } // --- END UPLIFTED RETRY LOOP ---

      await chapterPage.close();

      // Only write file if extraction was successful
      if (successfulExtraction) {
        // const htmlContent = chapterData.htmlContent;
        const htmlContent = `<div id="chapter-content">
  <h2 id=${chapterNumber}>${chapterData.pageTitle}</h2>
  <p>${chapterData.pageContent}</p>
</div>`;
        const fileName = `Chapter_${chapterNumber}.html`;
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, htmlContent, 'utf8');
        console.log(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Saved chapter ${chapterNumber} to ${fileName}.`);
      } else {
        console.warn(`[Tab ${tabIndex + 1} - Index ${chapterIndex}] Skipped chapter ${chapterNumber} due to persistent extraction failure.`);
      }
    }

    await page.close();
    console.log(`Tab ${tabIndex + 1} done.`);
  }));
}


  // Run the main function
  main().catch(err => {
    console.error('Fatal error occurred:', err.message || err);
    process.exit(1);
  });
