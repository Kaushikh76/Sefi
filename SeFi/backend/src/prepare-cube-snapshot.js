import { createConfig } from './config.js';
import { SeFiDatabase } from './database.js';

async function main() {
  const config = createConfig();
  const database = new SeFiDatabase(config);

  try {
    await database.init();
    console.log(
      JSON.stringify({
        ok: true,
        live_db_path: config.dbPath,
        cube_db_path: config.cubeDbPath,
        prepared_at: new Date().toISOString(),
      })
    );
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      failed_at: new Date().toISOString(),
    })
  );
  process.exit(1);
});
