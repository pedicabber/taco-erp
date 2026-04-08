import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import usersRouter from "./users";
import projectsRouter from "./projects";
import departmentsRouter from "./departments";
import tasksRouter from "./tasks";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(usersRouter);
router.use(projectsRouter);
router.use(departmentsRouter);
router.use(tasksRouter);
router.use(notificationsRouter);

export default router;
