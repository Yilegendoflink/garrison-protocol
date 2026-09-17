import fs from 'node:fs/promises';

const sourcePath = 'data/modes/alliance-lower/default-wave-table.json';
const outputPath = 'dist/native-wave-defaults.js';
const table = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

if (!table || typeof table !== 'object' || !table.types || typeof table.types !== 'object') {
  throw new Error(`${sourcePath} 不是有效的波次表导出文件`);
}

await fs.writeFile(
  outputPath,
  `// Generated from ${sourcePath}. Edit the JSON export, then rebuild.\nexport const DEFAULT_WAVE_TABLE = ${JSON.stringify(table, null, 2)};\n`,
);
console.log(`Built ${outputPath} from ${sourcePath}`);
