import { copyFileSync } from 'node:fs';

// tsc doesn't copy non-TS assets; the compiled db module reads schema.sql next to itself.
copyFileSync('src/db/schema.sql', 'dist/db/schema.sql');
