import pino from "pino";

/**
 * Structured logger. Tokens and raw Xero payloads are redacted wherever they appear.
 * Never pass report JSON or transaction rows as log fields; if you do, they are censored.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: [
      "access_token",
      "refresh_token",
      "id_token",
      "*.access_token",
      "*.refresh_token",
      "*.id_token",
      "*.*.access_token",
      "*.*.refresh_token",
      "authorization",
      "*.authorization",
      "headers.authorization",
      "report",
      "*.report",
      "rows",
      "*.rows",
      "Reports",
      "*.Reports",
      "Invoices",
      "*.Invoices",
      "BankTransactions",
      "*.BankTransactions",
    ],
    censor: "[redacted]",
  },
});
