// src/report.js

/**
 * Print a completeness report to stdout.
 * @param {import('./manifest').Manifest} mf
 */
function printReport(mf) {
  const byStatus = { success: [], no_captions: [], failed: [], pending: [] };
  for (const l of mf.lectures) {
    (byStatus[l.status] || byStatus.pending).push(l);
  }

  const total = mf.lectures.length;
  console.log('\n========== Transcript Download Report ==========');
  console.log(`Total lectures : ${total}`);
  console.log(`Success        : ${byStatus.success.length}`);
  console.log(`No captions    : ${byStatus.no_captions.length}`);
  console.log(`Failed         : ${byStatus.failed.length}`);
  console.log(`Still pending  : ${byStatus.pending.length}`);

  if (byStatus.no_captions.length > 0) {
    console.log('\n--- Lectures with no captions ---');
    for (const l of byStatus.no_captions) {
      console.log(`  ${l.sectionIndex}.${l.lectureIndex} ${l.title}`);
    }
  }

  if (byStatus.failed.length > 0) {
    console.log('\n--- Failed lectures (retry by re-running) ---');
    for (const l of byStatus.failed) {
      console.log(`  ${l.sectionIndex}.${l.lectureIndex} ${l.title}`);
    }
  }

  if (byStatus.pending.length > 0) {
    console.log('\n--- Still pending (run was interrupted) ---');
    for (const l of byStatus.pending) {
      console.log(`  ${l.sectionIndex}.${l.lectureIndex} ${l.title}`);
    }
  }

  console.log('================================================\n');
}

module.exports = { printReport };
