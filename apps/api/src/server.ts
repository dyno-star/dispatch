import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db/pool.js";
import { ConsoleSmsSender } from "./adapters/sms.js";
import { LocalDiskStorage } from "./adapters/storage.js";
import { EstimateMaps } from "./adapters/maps.js";
import { loadCityConfig } from "./modules/pricing/city.js";

const db = createPool(config.databaseUrl);

const app = buildApp({
  db,
  sms: new ConsoleSmsSender(),
  storage: new LocalDiskStorage(config.uploadDir),
  maps: new EstimateMaps(),
  city: loadCityConfig(config.cityConfigPath),
  jwtSecret: config.jwtSecret,
  otpSecret: config.otpSecret,
});

app.addHook("onClose", () => db.end());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
