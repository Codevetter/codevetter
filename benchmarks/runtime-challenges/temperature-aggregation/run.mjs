import { readFile } from 'node:fs/promises';

import { aggregateTemperatures, formatOfficialResults } from './parser.mjs';

const inputPath = process.argv[2] ?? 'measurements.txt';
const input = await readFile(inputPath, 'utf8');
process.stdout.write(`${formatOfficialResults(aggregateTemperatures(input))}\n`);
