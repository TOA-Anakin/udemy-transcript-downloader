const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, 'output');
const sectionsDir = path.join(outputDir, 'sections');
const contentsFile = path.join(outputDir, 'CONTENTS.txt');

// Parse CONTENTS.txt to get section structure
const contents = fs.readFileSync(contentsFile, 'utf8');
const lines = contents.split('\n');

const sections = [];
let currentSection = null;

for (const line of lines) {
  // Match section headers like "1. Introduction"
  const sectionMatch = line.match(/^(\d+)\.\s+(.+)$/);
  // Match lecture lines like "1.1 Course Overview [14 min, 11/21/2025]"
  const lectureMatch = line.match(/^(\d+)\.(\d+)\s+(.+?)\s+\[\d+ min,/);

  if (sectionMatch && !lectureMatch) {
    currentSection = {
      index: sectionMatch[1],
      title: sectionMatch[2],
      lectures: []
    };
    sections.push(currentSection);
  } else if (lectureMatch && currentSection) {
    currentSection.lectures.push({
      prefix: `${lectureMatch[1]}.${lectureMatch[2]}`,
      title: lectureMatch[3]
    });
  }
}

// For each section, concatenate all lecture .txt files
for (const section of sections) {
  let combined = `${'='.repeat(60)}\nSection ${section.index}: ${section.title}\n${'='.repeat(60)}\n\n`;

  for (const lecture of section.lectures) {
    // Find matching txt file
    const prefix = `${lecture.prefix} `;
    const files = fs.readdirSync(outputDir).filter(f =>
      f.startsWith(prefix) && f.endsWith('.txt') && !f.includes('[')
    );

    if (files.length > 0) {
      const content = fs.readFileSync(path.join(outputDir, files[0]), 'utf8');
      combined += `${'─'.repeat(40)}\n${lecture.prefix} ${lecture.title}\n${'─'.repeat(40)}\n`;
      // Strip the "# filename" header line if present
      const body = content.replace(/^# .+\n\n?/, '');
      combined += body.trim() + '\n\n';
    } else {
      combined += `${'─'.repeat(40)}\n${lecture.prefix} ${lecture.title}\n${'─'.repeat(40)}\n[No transcript file found]\n\n`;
    }
  }

  const sectionFilename = `Section ${section.index} - ${section.title.replace(/[/\\?%*:|"<>]/g, '-')}.txt`;
  fs.writeFileSync(path.join(sectionsDir, sectionFilename), combined, 'utf8');
  console.log(`Created: ${sectionFilename} (${section.lectures.length} lectures)`);
}

console.log(`\nDone! ${sections.length} section files created in output/sections/`);
