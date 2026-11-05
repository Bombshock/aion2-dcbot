// Root entry point for hosts that run `node index.js`.
// Runs the TypeScript sources directly through tsx, so the server needs no build step
// and never starts from a stale dist/ after pulling new code.
import { register } from 'tsx/esm/api';

register();
await import('./src/index.ts');
