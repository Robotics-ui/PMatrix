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
import { seedDefaultAccounts } from "./lib/seed";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
app.use(cors());
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

export default app;
