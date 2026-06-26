import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import studentsRouter from "./students";
import groupsRouter from "./groups";
import templatesRouter from "./templates";
import accountsRouter from "./accounts";
import campaignsRouter from "./campaigns";
import settingsRouter from "./settings";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(studentsRouter);
router.use(groupsRouter);
router.use(templatesRouter);
router.use(accountsRouter);
router.use(campaignsRouter);
router.use(settingsRouter);
router.use(statsRouter);

export default router;
