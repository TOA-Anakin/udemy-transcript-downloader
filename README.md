# Udemy Transcript Downloader

A NodeJS-based tool for downloading transcripts from Udemy courses. This script uses Puppeteer for authentication, then fetches transcripts via the Udemy API.

## Features

- Downloads transcripts from any Udemy course you have access to
- Creates individual transcript files for each lecture
- Scrapes and saves course content structure
- Supports email-based authentication with verification code
- Handles Cloudflare security challenges
- Manifest-based resume: skips already-downloaded lectures on re-run

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

## Usage

```bash
node src/index.js "https://www.udemy.com/course/your-course/"
```

The script will:
1. Ask which lecture index to start from (default 1)
2. Open a browser for login (email verification code or SSO — complete in the browser window)
3. Close the browser once authenticated
4. Fetch the full course curriculum via the Udemy API (paginated, handles >200 lectures)
5. Create or load `output/<courseId>/manifest.json`
6. Download each lecture transcript sequentially, with retries and backoff
7. Save plain-text `.md` files to `output/<courseId>/`
8. Print a completeness report on finish or Ctrl+C

## Output Files

All output is saved under `output/<courseId>/`:

- `manifest.json` — tracks status per lecture: `pending`, `success`, `no_captions`, `failed`
- `CONTENTS.txt` — full course outline
- `<section>.<index> <title>.md` — plain-text transcript per lecture

## Resuming

Re-run with the same course URL. Lectures already marked `success` or `no_captions` are skipped automatically. Only `pending` and `failed` lectures are retried.

## Completeness Report

Printed at the end of every run (or immediately on Ctrl+C). Lists:
- All lectures with no available captions
- All lectures that failed after retries (safe to retry by re-running)
- Any lectures still pending (run was interrupted mid-way)

## Troubleshooting

- **Verification Code Issues**: Make sure to enter the verification code quickly after receiving it in your email
- **Browser Crashing**: If you experience issues with headless mode, you can modify the script to use `headless: false` for debugging
- **Missing Transcripts**: Lectures without captions are marked `no_captions` in the manifest and listed in the completeness report. This is expected for some lectures.
- **Failed Downloads**: Re-run the script — only `pending` and `failed` lectures will be retried.
- **Course ID Not Found**: Make sure you are enrolled in the course and the URL is correct.

## License

MIT

## Disclaimer

This tool is for personal use only. Please respect Udemy's terms of service.
