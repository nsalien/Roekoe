/**
 * Entry point of a demo build: index.html points here instead of at
 * src/main.tsx (see client/vite.config.ts). Set up the in-page world, then
 * start the normal app — which never knows it is a demo.
 */
import { bootDemo } from './index';

bootDemo().then(() => import('../src/main.tsx'));
