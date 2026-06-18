import { Router, type IRouter, type Request, type Response } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import subscriptionsRouter from "./subscriptions";
import paymentsRouter from "./payments";
import masterAccountsRouter from "./masterAccounts";
import slaveAccountsRouter from "./slaveAccounts";
import strategiesRouter from "./strategies";
import bindingsRouter from "./bindings";
import tradeLogsRouter from "./tradeLogs";
import dashboardRouter from "./dashboard";
import adminRouter from "./admin";
import webhooksRouter from "./webhooks";
import mediaCenterRouter from "./mediaCenter";
import newsRouter from "./news";
import resourcesRouter from "./resources";
import announcementsRouter from "./announcements";
import forexRouter from "./forex";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(subscriptionsRouter);
router.use(paymentsRouter);
router.use(masterAccountsRouter);
router.use(slaveAccountsRouter);
router.use(strategiesRouter);
router.use(bindingsRouter);
router.use(tradeLogsRouter);
router.use(dashboardRouter);
router.use(adminRouter);
router.use(webhooksRouter);
router.use(mediaCenterRouter);
router.use(newsRouter);
router.use(resourcesRouter);
router.use(announcementsRouter);
router.use(forexRouter);

// Catch-all for unmatched /api routes — return JSON instead of falling through to the React app
router.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "API route not found" });
});

export default router;
