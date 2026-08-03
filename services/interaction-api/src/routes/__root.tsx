import { createRootRoute } from '@tanstack/react-router';

// This service is API-only: the router requires a root route to exist, but it
// renders nothing. The actual API lives under /api/* as server routes.
export const Route = createRootRoute();
