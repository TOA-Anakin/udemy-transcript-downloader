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
