// src/contents.js
const fs = require('node:fs');
const path = require('node:path');

/**
 * Write a CONTENTS.txt to output/<courseId>/ listing all lectures with section grouping.
 * @param {string} outputDir
 * @param {string} courseId
 * @param {import('./manifest').LectureEntry[]} lectures  — full flat list
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
