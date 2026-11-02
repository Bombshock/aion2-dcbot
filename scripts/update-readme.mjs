import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Rewrites the roadmap section of README.md from the ticket board in tickets/<state>/.
// With --check it only reports whether README.md is out of date (exit code 1 if so).

const START = '<!-- roadmap:start -->';
const END = '<!-- roadmap:end -->';

const SECTIONS = [
  { heading: 'Done', states: ['done'], done: true },
  { heading: 'In review', states: ['qa'], done: true },
  { heading: 'In progress', states: ['progress'], done: false },
  { heading: 'Planned', states: ['todo', 'refinement'], done: false },
];

function ticketTitle(dir, file) {
  const heading = readFileSync(join(dir, file), 'utf8').match(/^# (.+)$/m);
  const title = heading ? heading[1].trim() : file.replace(/^\d+_/, '').replace(/\.md$/, '').replaceAll('_', ' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function ticketsIn(state) {
  const dir = join('tickets', state);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ticketTitle(dir, f));
}

function roadmap() {
  const lines = [];
  for (const section of SECTIONS) {
    const titles = section.states.flatMap(ticketsIn);
    if (titles.length === 0) continue;
    lines.push(`### ${section.heading}`, '');
    for (const title of titles) lines.push(`- [${section.done ? 'x' : ' '}] ${title}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

const readme = readFileSync('README.md', 'utf8').replace(/\r\n/g, '\n');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) throw new Error(`README.md needs ${START} and ${END} markers`);

const updated = `${readme.slice(0, start + START.length)}\n${roadmap()}\n${readme.slice(end)}`;

if (process.argv.includes('--check')) {
  if (updated !== readme) {
    console.error('README.md roadmap is out of date; run `npm run readme`.');
    process.exit(1);
  }
} else if (updated !== readme) {
  writeFileSync('README.md', updated);
  console.log('README.md roadmap updated');
}
