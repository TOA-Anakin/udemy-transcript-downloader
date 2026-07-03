# Udemy Transcript Downloader

A NodeJS-based tool for downloading transcripts from Udemy courses. This script uses Puppeteer to navigate through Udemy's UI and extract transcripts for each lecture in a course.

## Features

- Downloads transcripts from any Udemy course you have access to
- Creates individual transcript files for each lecture
- Generates a combined transcript file with all lectures
- Optionally downloads `.srt` files with timestamps for each lecture
- Scrapes and saves course content structure
- Supports email-based authentication with verification code
- Handles Cloudflare security challenges
- Runs in headless mode for better performance

## Prerequisites

- Node.js (v14 or newer)
- NPM
- A Udemy account with access to the course you want to download transcripts from

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/TOA-Anakin/udemy-transcript-downloader.git
   cd udemy-transcript-downloader
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with your Udemy email:
   ```
   UDEMY_EMAIL=your-email@example.com
   ```

   Optionally, if Puppeteer's bundled browser fails to launch on your machine,
   point the tool at a locally installed browser (see `.env.example`):
   ```
   PUPPETEER_EXECUTABLE_PATH=/path/to/your/chrome
   ```

## Usage

Run the script with the URL of the Udemy course as an argument:

```
npm start "https://www.udemy.com/course/your-course-url/"
```

Or use the direct Node.js command:

```
node src/index.js "https://www.udemy.com/course/your-course-url/"
```

The script will:

1. Ask if you want to download `.srt` files (with timestamps) for each lecture
2. Ask how many tabs to use for downloading transcripts (default is 5)
   - A higher number can speed things up, but requires a good PC (enough CPU and RAM)
3. Open a headless browser and navigate to Udemy login
4. Fill in your email from the .env file
5. Ask you to enter the 6-digit verification code from your email
6. Navigate to the course page
7. Scrape course content structure
8. Enter the course player
9. Go through each lecture and download available transcripts
10. Save individual transcript files in the `output` directory

## Output Files

All output files are saved to the `output` directory:

- `CONTENTS.txt` - Course structure with sections and lectures
- `[Lecture Name].txt` - Individual transcript files for each lecture
- `[Lecture Name].srt` - Individual transcript files with timestamps in SubRip format (optional)

## Troubleshooting

- **Verification Code Issues**: Make sure to enter the verification code quickly after receiving it in your email
- **Browser Crashing**: If you experience issues with headless mode, you can modify the script to use `headless: false` for debugging
- **Browser Fails to Launch**: If the browser exits immediately on startup (for example `spawn ... error -88` / an instantly killed process on an Apple Silicon Mac, where the bundled "Chrome for Testing" ships unsigned), set `PUPPETEER_EXECUTABLE_PATH` in your `.env` to a locally installed, properly signed Chromium-based browser. See `.env.example` for per-platform paths.
- **Missing Transcripts**: Not all lectures may have transcripts. The script will create empty files for lectures without transcripts.
- **SRT Errors**: If `.srt` generation fails for a lecture, try increasing timeouts or re-running the script with fewer browser tabs open.
- **Slow Transcript Downloads**: The script can download transcripts in parallel using multiple browser tabs. If your PC is slow or has limited memory, stick to a lower number of tabs (e.g. 1–3). If you have a powerful machine, you can safely use 5 or more tabs for faster processing.

## License

MIT

## Disclaimer

This tool is for personal use only. Please respect Udemy's terms of service.
