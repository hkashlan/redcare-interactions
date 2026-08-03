import { createFileRoute } from '@tanstack/react-router';
import { getInteractionsHandler } from '../../server/app';

export const Route = createFileRoute('/api/interactions')({
  server: {
    handlers: {
      GET: ({ request }) => getInteractionsHandler()(request),
    },
  },
});
