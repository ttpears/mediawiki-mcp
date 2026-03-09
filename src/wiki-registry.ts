import { WikiConfig } from './types.js';

export class WikiRegistry {
  private wikis = new Map<string, WikiConfig>();
  private defaultName: string | undefined;

  addWiki(config: WikiConfig): void {
    const key = config.name.toLowerCase();
    if (this.wikis.has(key)) {
      throw new Error(`Wiki "${config.name}" is already registered`);
    }
    this.wikis.set(key, config);
    if (this.wikis.size === 1) {
      this.defaultName = key;
    }
  }

  removeWiki(name: string): void {
    const key = name.toLowerCase();
    if (!this.wikis.has(key)) {
      throw new Error(`Wiki "${name}" is not registered`);
    }
    this.wikis.delete(key);
    if (this.defaultName === key) {
      const firstKey = this.wikis.keys().next().value;
      this.defaultName = firstKey ?? undefined;
    }
  }

  getWiki(name: string): WikiConfig | undefined {
    return this.wikis.get(name.toLowerCase());
  }

  getDefaultWiki(): WikiConfig | undefined {
    if (this.defaultName === undefined) return undefined;
    return this.wikis.get(this.defaultName);
  }

  setDefault(name: string): void {
    const key = name.toLowerCase();
    if (!this.wikis.has(key)) {
      throw new Error(`Wiki "${name}" is not registered`);
    }
    this.defaultName = key;
  }

  getAllWikis(): WikiConfig[] {
    return Array.from(this.wikis.values());
  }

  resolveWiki(name?: string): WikiConfig {
    if (name !== undefined) {
      const wiki = this.getWiki(name);
      if (!wiki) {
        throw new Error(`Wiki "${name}" is not registered`);
      }
      return wiki;
    }
    const defaultWiki = this.getDefaultWiki();
    if (!defaultWiki) {
      throw new Error('No wikis are registered');
    }
    return defaultWiki;
  }

  static fromEnvironment(env: Record<string, string | undefined>): WikiRegistry {
    const registry = new WikiRegistry();

    const wikisEnv = env['MEDIAWIKI_WIKIS'];
    if (wikisEnv) {
      const entries = wikisEnv.split(',').map(e => e.trim()).filter(e => e.length > 0);
      for (const entry of entries) {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) {
          throw new Error(`Invalid wiki entry "${entry}": expected "Name:URL" format`);
        }
        const name = entry.substring(0, colonIdx).trim();
        const baseUrl = entry.substring(colonIdx + 1).trim();
        const tokenKey = `MEDIAWIKI_API_TOKEN_${name.toUpperCase()}`;
        const apiToken = env[tokenKey];
        registry.addWiki({ name, baseUrl, ...(apiToken ? { apiToken } : {}) });
      }

      const defaultWiki = env['MEDIAWIKI_DEFAULT_WIKI'];
      if (defaultWiki) {
        registry.setDefault(defaultWiki);
      }

      return registry;
    }

    // Fallback: single wiki from MEDIAWIKI_BASE_URL
    const baseUrl = env['MEDIAWIKI_BASE_URL'];
    if (baseUrl) {
      const apiToken = env['MEDIAWIKI_API_TOKEN'];
      registry.addWiki({ name: 'default', baseUrl, ...(apiToken ? { apiToken } : {}) });
      return registry;
    }

    throw new Error(
      'No wiki configuration found. Set MEDIAWIKI_WIKIS or MEDIAWIKI_BASE_URL environment variables.'
    );
  }
}
