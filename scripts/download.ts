// Downloads the latest public Jolpica F1 database dump (CSV) into data/raw.
// The free dump is 14 days behind and licensed for non-commercial use: https://github.com/jolpica/jolpica-f1
import { mkdir, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

const URL_ = 'https://api.jolpi.ca/data/dumps/download/delayed/?dump_type=csv';
const target = new URL('../data/raw/', import.meta.url);

console.log('Downloading the Jolpica F1 dump...');
const response = await fetch(URL_);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const files = unzipSync(new Uint8Array(await response.arrayBuffer()));

await mkdir(target, { recursive: true });
let count = 0;
for (const [name, content] of Object.entries(files)) {
  // Only flat CSV files; never follow paths from inside the archive.
  if (!/^[\w.-]+\.csv$/.test(name)) continue;
  await writeFile(new URL(name, target), content);
  count++;
}
console.log(`Saved ${count} CSV files to data/raw/`);
