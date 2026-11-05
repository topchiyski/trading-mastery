// Apply pending migrations to the configured database (DB_PATH, default data/journal.db).
import { dbPath, loadEnv } from '../src/config';
import { openDatabase } from '../src/db/client';

loadEnv();
const file = dbPath();
const database = openDatabase(file); // openDatabase migrates on open
database.close();
console.log(`db:migrate — ${file} is up to date.`);
