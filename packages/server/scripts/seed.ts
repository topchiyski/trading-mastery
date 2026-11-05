// Load the demo data set. Refuses to touch a database that has executions unless --force,
// which WIPES every table first. Usage: npm run db:seed [-- --force]
import { getTableName, sql } from 'drizzle-orm';
import { dbPath, loadEnv } from '../src/config';
import { openDatabase } from '../src/db/client';
import * as schema from '../src/db/schema';
import { seedDemo } from '../src/seed/demo';

loadEnv();
const file = dbPath();
const force = process.argv.includes('--force');
const { db, close } = openDatabase(file);

try {
  if (force) {
    // Children before parents so foreign keys hold.
    const tables = [
      schema.tradeExecutions,
      schema.tradeTags,
      schema.stopChanges,
      schema.screenshots,
      schema.trades,
      schema.executions,
      schema.cashFlows,
      schema.importBatches,
      schema.tags,
      schema.settings,
    ];
    db.transaction((tx) => {
      for (const t of tables) tx.run(sql.raw(`DELETE FROM "${getTableName(t)}"`));
    });
    console.log(`db:seed — wiped ${file}`);
  }
  const { trades } = seedDemo(db);
  console.log(`db:seed — loaded ${trades} demo trades into ${file}`);
} catch (err) {
  console.error(`db:seed — ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  close();
}
