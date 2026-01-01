const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '../output');
// Define both output filenames
console.log(process.argv[3]);
const outputHtmlFile = path.join(__dirname, '../' + 'output.html');

/**
 * Generates the full HTML content for the book.
 * @param {string[]} files - Sorted list of chapter filenames.
 * @param {boolean} includeToc - Whether to include the Table of Contents.
 * @returns {string} The complete HTML content.
 */
function generateHtmlContent(files, includeToc) {
  // --- 1. Start the combined HTML structure (Head and CSS) ---
  const styleBlock = `
        * {
            margin: 0 !important;
        }

        body {
            margin: 8px !important;
            line-height: 16pt;
        }

        a {
            font-weight: 700;
            text-decoration: none
        }

        a.toclv2 {
            color: red;
            text-align: center
        }

        h2 {
            color: red;
            font-weight: 700
        }

        .chapter-img {
            font-weight: 100
        }

        #info {
            font-weight: 700;
            text-align: center;
        }

        #nt,
        #tg {
            color: red;
        }

        #cvt {
            color: blue;
        }

        #ng {
            color: purple;
        }

        #gt {
            font-weight: 100
        }

        #sc {
            color: green
        }

        #tt {
            color: blue
        }
  `;

  let combinedHtml = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title></title>
  <style>${styleBlock}</style>
</head>
<body>
`;

  // Temporary array to hold the actual chapter HTML fragments
  const chapterContents = [];
  const tocEntries = []; // Array to store { id, title } for the TOC

  
  // Build chapter contents and collect metadata
  files.forEach(file => {
      // Extracts the chapter number from the filename
      const chapterNumber = file.match(/\d+/)[0]; 
      // Read the content fragment saved by metruyenchu.js
      const chapterContent = fs.readFileSync(path.join(outputDir, file), 'utf8');
      chapterContents.push({ chapterNumber, chapterContent, fileName: file });

      // Use regex to safely extract the content inside the first <h2> tag.
      // The 's' flag allows '.' to match newlines.
      const titleMatch = chapterContent.match(/<h2[^>]*>(.*?)<\/h2>/i);
      const chapterTitle = titleMatch ? titleMatch[1].trim() : `Chapter ${chapterNumber} (Title Missing)`;

      // Store the title and the chapter ID for creating the link
      tocEntries.push({ id: chapterNumber, title: chapterTitle });
  });

  console.log(`tocEntries: ${tocEntries.length}`)
  tocEntries.forEach(entry => console.log(`ID: ${entry.id}, Title: ${entry.title}`));
  
  // --- 2. Build the Table of Contents (TOC) ---
  combinedHtml += `
    <div id="toc_container">
      <p class="toc_title">Table of Contents</p>
      <ul class="toc_list">
`;
    // combinedHtml += tocEntries.map(entry => 
    //         // Create a link that jumps to the chapter's div using its ID
    //         `<a href="#${entry.id}">${entry.title}</a> <br>`
    //     ).join('\n');
    combinedHtml += tocEntries.map(entry => 
            // Create a link that jumps to the chapter's div using its ID
            `<li><a href="#${entry.id}">${entry.title}</a></li>`
        ).join('\n');
  // --- 3. Add all chapter content ---
  combinedHtml += '</ul> </div><br> <br> \n' + chapterContents.map(item => item.chapterContent).join('\n');
  
  // --- 4. Close the body and html tags ---
  combinedHtml += `
</body>
</html>
`;

  return combinedHtml;
}


(async () => {
  console.log('--- Starting HTML File Combination ---');
  try {
    // Read all files in the output directory, filtering for HTML fragments
    const files = fs.readdirSync(outputDir).filter(file => file.endsWith('.html'));

    if (files.length === 0) {
        console.error('Error: No HTML chapter fragments found in the /output directory.');
        console.log('Please run metruyenchu.js first to download the chapters.');
        return;
    }

    // Sort files numerically by the chapter number in the filename (e.g., Chapter_0900.html)
    files.sort((a, b) => {
      const matchA = a.match(/\d+/);
      const matchB = b.match(/\d+/);

      if (!matchA || !matchB) return 0;

      const chapterA = parseInt(matchA[0], 10);
      const chapterB = parseInt(matchB[0], 10);
      return chapterA - chapterB;
    });

    // Generate and save the version WITH TOC
    const htmlWithToc = generateHtmlContent(files, true);
    fs.writeFileSync(outputHtmlFile, htmlWithToc, 'utf8');
    console.log(`\n🎉 Success! Combined book created: ${outputHtmlFile}`);
    
  } catch (error) {
    console.error('Error building combined HTML file:', error.message);
    console.log('Ensure you have run metruyenchu.js and that the /output directory contains files.');
  }
})();
