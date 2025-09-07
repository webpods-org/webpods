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
router.get(rootRoute.path, ...rootRoute.middleware, async (req, res, next) => {
  // Call the root handler
  await rootRoute.handler(req, res, next);

  // Check if we need to re-route based on .config/routing
  if ((req as any).needsReroute) {
    delete (req as any).needsReroute;
    // Re-run the router with the rewritten URL
    return router(req, res, next);
  }
});

// 5. Catch-all routes for POST and DELETE
router.post(postRoute.path, ...postRoute.middleware, postRoute.handler);
router.delete(deleteRoute.path, ...deleteRoute.middleware, deleteRoute.handler);

// 6. Final catch-all for GET requests (must be last)
// This will catch any GET request that hasn't been handled by specific routes
router.use(async (req, res, next) => {
  // Only handle GET requests
  if (req.method !== "GET") {
    return next();
  }

  // Run the GET middleware chain
  let middlewareIndex = 0;
  const runMiddleware = () => {
    if (middlewareIndex < getRoute.middleware.length) {
      const mw = getRoute.middleware[middlewareIndex++];
      if (mw) {
        mw(req as any, res, runMiddleware);
      } else {
        runMiddleware();
      }
    } else {
      // All middleware done, run handler
      const originalUrl = req.url;
      getRoute.handler(req as any, res, next).then(() => {
        // If the URL was rewritten for link resolution, re-run the router
        if (req.url !== originalUrl) {
          router(req, res, next);
        }
      });
    }
  };

  runMiddleware();
});

export default router;
