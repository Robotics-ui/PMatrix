import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { startAccountPoller } from "./lib/accountPoller";
import { startReconnectWorker } from "./lib/reconnectWorker";
import { seedDefaultAccounts, seedReferralSettings } from "./lib/seed";
import { startSmsWorker } from "./lib/smsWorker";
import { seedDefaultTemplates } from "./lib/smsService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Startup environment guard ─────────────────────────────────────────────────
// Fail loudly in production if critical secrets are using insecure defaults.
if (process.env.NODE_ENV === "production") {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === "pesamatrix-secret-key") {
    throw new Error(
      "[FATAL] SESSION_SECRET must be set to a strong random value in production. " +
      "The default fallback 'pesamatrix-secret-key' is not safe for production use."
    );
  }
  if (!process.env.COPYFACTORY_WEBHOOK_SECRET) {
    // Log a warning but don't crash — webhook route will fail-closed on its own.
    console.error(
      "[WARN] COPYFACTORY_WEBHOOK_SECRET is not set. The /api/webhooks/copyfactory endpoint " +
      "will reject all requests until this is configured."
    );
  }
}

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ── CORS ─────────────────────────────────────────────────────────────────────
// In production set ALLOWED_ORIGIN to your exact domain (e.g. https://pesamatrix.replit.app).
// In development / demo mode the wildcard is preserved so the Replit proxy works.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors(
    allowedOrigin
      ? {
          origin: allowedOrigin,
          credentials: true,
        }
      : undefined, // wildcard — safe for dev, but set ALLOWED_ORIGIN in production
  ),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
  skip: () => process.env.NODE_ENV === "test",
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many payment requests, please wait before trying again" },
  skip: () => process.env.NODE_ENV === "test",
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
  skip: () => process.env.NODE_ENV === "test",
});

// Apply rate limiters before routing
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/payments/callback", paymentLimiter);
app.use("/api/payments", paymentLimiter);
app.use("/api", generalLimiter);

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const staticDir = path.resolve(__dirname, "../../pesamatrix/dist/public");
  app.use(express.static(staticDir));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// Seed default accounts on first run
void seedDefaultAccounts();

// Start the subscription expiry scheduler
startScheduler();
// Start MetaApi account status poller (every 30s)
startAccountPoller();
// Start MetaApi reconnect worker (every 5min)
startReconnectWorker();
// Start SMS queue worker (every minute)
startSmsWorker();
// Seed default SMS templates
void seedDefaultTemplates();
// Seed default referral reward milestones
void seedReferralSettings();

export default app;
