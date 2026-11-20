import { app } from "./app.js";
import { initialize, pool } from "./db.js";
import { config } from "./config.js";
import { log } from "./log.js";
if (!config.databaseUrl) throw new Error("Set DATABASE_URL in backend/.env");
await initialize();
const server = app.listen(config.port, config.host, () =>
  log("server_started", {
    host: config.host,
    port: config.port,
    model: config.model,
  }),
);
server.requestTimeout = 300000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
