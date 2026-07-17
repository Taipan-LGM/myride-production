const NODE_ENV = process.env.NODE_ENV || "development";

function formatMeta(meta) {
  if (!meta) return "";
  if (typeof meta === "string") return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const logger = {
  info(message, meta) {
    // eslint-disable-next-line no-console
    console.log(`[my-ride] ${message}`, meta != null ? formatMeta(meta) : "");
  },
  debug(message, meta) {
    if (NODE_ENV === "production" && process.env.LOG_LEVEL !== "debug") return;
    // eslint-disable-next-line no-console
    console.debug(`[my-ride:debug] ${message}`, meta != null ? formatMeta(meta) : "");
  },
  warn(message, meta) {
    // eslint-disable-next-line no-console
    console.warn(`[my-ride:warn] ${message}`, meta != null ? formatMeta(meta) : "");
  },
  error(message, meta) {
    // eslint-disable-next-line no-console
    console.error(`[my-ride:error] ${message}`, meta != null ? formatMeta(meta) : "");
  },
};

export default logger;
