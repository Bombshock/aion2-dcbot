// Root entry point for hosts that run `node index.js`.
// `npm install` builds the app into dist/ through the postinstall script.
await import('./dist/index.js');
