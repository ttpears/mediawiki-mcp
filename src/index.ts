#!/usr/bin/env node

import { createStdioServer } from './stdio.js';
import { WikiRegistry } from './wiki-registry.js';

const registry = WikiRegistry.fromEnvironment(process.env as Record<string, string>);

createStdioServer(registry).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
