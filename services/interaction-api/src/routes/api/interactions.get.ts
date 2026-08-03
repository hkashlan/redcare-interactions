import { defineHandler } from 'nitro';
import { getInteractionsHandler } from '../../server/app';

export default defineHandler((event) => getInteractionsHandler()(event.req));
