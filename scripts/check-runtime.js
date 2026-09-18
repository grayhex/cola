import { validateRuntime } from "../lib/runtime-config.js";
try {
  console.log(
    JSON.stringify({
      level: "info",
      event: "startup_config",
      ...validateRuntime(),
    }),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      level: "fatal",
      event: "startup_config_invalid",
      message: e.message,
    }),
  );
  process.exit(1);
}
