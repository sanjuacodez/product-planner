#!/usr/bin/env node
import { main } from '../src/cli.js';
main(process.argv.slice(2)).catch((err) => {
  console.error(`error: ${err.message}`);
  if (process.env.PP_DEBUG) console.error(err.stack);
  process.exit(1);
});
