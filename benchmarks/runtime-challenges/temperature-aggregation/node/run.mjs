import { aggregateFile } from './file-parser.mjs';
import { formatOfficialResults } from '../parser.mjs';

const [path, workersText = '1'] = process.argv.slice(2);
if (!path) throw new Error('usage: node run.mjs measurements.txt [workers]');
const workers = Number.parseInt(workersText, 10);
const aggregates = await aggregateFile(path, workers);
process.stdout.write(`${formatOfficialResults(aggregates)}\n`);
