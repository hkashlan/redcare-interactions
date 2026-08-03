import { createFileRoute } from '@tanstack/react-router';
import { handleHealth } from '../../server/handlers/health';

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) => handleHealth(request),
    },
  },
});
