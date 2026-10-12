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
