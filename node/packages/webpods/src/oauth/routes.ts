/**
 * OAuth routes aggregator
 */

import { Router } from "express";
import loginRouter from "./login.js";
import consentRouter from "./consent.js";
import registrationRouter from "./client-registration.js";

const router = Router();

// Mount OAuth endpoints
router.use("/", loginRouter);
router.use("/", consentRouter);
router.use("/", registrationRouter);

export default router;
