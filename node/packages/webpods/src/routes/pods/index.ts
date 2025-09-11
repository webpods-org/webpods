/**
 * Pod and stream routes - main router
 */

import { Router } from "express";

// Import all route handlers
import { loginRoute } from "./login.js";
import { authCallbackRoute } from "./auth-callback.js";
import { listStreamsRoute } from "./streams.js";
import { deletePodRoute } from "./delete-pod.js";
import {
  transferOwnerRoute,
  updateRoutingRoute,
  updateDomainsRoute,
} from "./config.js";
import { rootRoute } from "./root.js";
import { getRoute } from "./get.js";
import { postRoute } from "./post.js";
import { deleteRoute } from "./delete.js";

const router = Router({ mergeParams: true });

// Register routes in specific order (more specific routes first)

// 1. Authentication routes
router.get(loginRoute.path, ...loginRoute.middleware, loginRoute.handler);
router.get(
  authCallbackRoute.path,
  ...authCallbackRoute.middleware,
  authCallbackRoute.handler,
);

// 2. Config API routes
router.get(
  listStreamsRoute.path,
  ...listStreamsRoute.middleware,
  listStreamsRoute.handler,
);
router.post(
  transferOwnerRoute.path,
  ...transferOwnerRoute.middleware,
  transferOwnerRoute.handler,
);
router.post(
  updateRoutingRoute.path,
  ...updateRoutingRoute.middleware,
  updateRoutingRoute.handler,
);
router.post(
  updateDomainsRoute.path,
  ...updateDomainsRoute.middleware,
  updateDomainsRoute.handler,
);

// 3. Pod deletion (specific path "/")
router.delete(
  deletePodRoute.path,
  ...deletePodRoute.middleware,
  deletePodRoute.handler,
);

// 4. Root path handler (must come before catch-all)
router.get(rootRoute.path, ...rootRoute.middleware, rootRoute.handler);

// 5. Catch-all routes (must be last)
// We need to register multiple patterns to catch all paths
// First, handle single-segment paths like /about, /status
router.get("/:segment", ...getRoute.middleware, getRoute.handler);

// Then handle multi-segment paths like /api/v1/status
router.get("/*", ...getRoute.middleware, getRoute.handler);

router.post(postRoute.path, ...postRoute.middleware, postRoute.handler);
router.delete(deleteRoute.path, ...deleteRoute.middleware, deleteRoute.handler);

export default router;
