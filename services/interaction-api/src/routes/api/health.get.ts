import { defineHandler } from 'nitro';
import { handleHealth } from '../../server/handlers/health';

export default defineHandler((event) => handleHealth(event.req));
