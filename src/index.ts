#!/usr/bin/env node

import { createStdioServer } from "./stdio.js";
import type { MediaWikiConfig } from "./types.js";

// Load configuration from environment variables
const config: MediaWikiConfig = {
  baseUrl: process.env.MEDIAWIKI_BASE_URL || "",
  username: process.env.MEDIAWIKI_USERNAME,
  password: process.env.MEDIAWIKI_PASSWORD,
  apiToken: process.env.MEDIAWIKI_API_TOKEN
};

// Validate required configuration
if (!config.baseUrl) {
  console.error("Error: MEDIAWIKI_BASE_URL environment variable is required");
  process.exit(1);
}

// Start the server
createStdioServer(config).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
