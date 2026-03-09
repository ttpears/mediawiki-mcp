import { describe, it, expect } from 'vitest';
import { WikiRegistry } from '../src/wiki-registry.js';

describe('WikiRegistry', () => {
  it('adds a wiki and retrieves it', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    const wiki = reg.getWiki('Sales');
    expect(wiki).toEqual({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
  });

  it('first wiki added becomes the default', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    reg.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
    expect(reg.getDefaultWiki()?.name).toBe('Sales');
  });

  it('throws on duplicate name', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    expect(() => reg.addWiki({ name: 'sales', baseUrl: 'https://other.com' }))
      .toThrow('already registered');
  });

  it('removes a wiki', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    reg.removeWiki('Sales');
    expect(reg.getWiki('Sales')).toBeUndefined();
  });

  it('reassigns default when removing the default wiki', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    reg.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
    reg.removeWiki('Sales');
    expect(reg.getDefaultWiki()?.name).toBe('Dev');
  });

  it('throws when removing unknown wiki', () => {
    const reg = new WikiRegistry();
    expect(() => reg.removeWiki('Nope')).toThrow('not registered');
  });

  it('returns all wikis', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    reg.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
    const all = reg.getAllWikis();
    expect(all).toHaveLength(2);
    expect(all.map(w => w.name)).toEqual(['Sales', 'Dev']);
  });

  it('resolves wiki by name', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    const wiki = reg.resolveWiki('Sales');
    expect(wiki.name).toBe('Sales');
  });

  it('resolves default wiki when no name given', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    reg.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
    const wiki = reg.resolveWiki();
    expect(wiki.name).toBe('Sales');
  });

  it('throws when resolving unknown name', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    expect(() => reg.resolveWiki('Nope')).toThrow('not registered');
  });

  it('throws when resolving with no wikis registered', () => {
    const reg = new WikiRegistry();
    expect(() => reg.resolveWiki()).toThrow('No wikis are registered');
  });

  it('uses case-insensitive name matching', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    expect(reg.getWiki('SALES')?.name).toBe('Sales');
    expect(reg.getWiki('sales')?.name).toBe('Sales');
    const resolved = reg.resolveWiki('sAlEs');
    expect(resolved.name).toBe('Sales');
  });

  it('sets default wiki', () => {
    const reg = new WikiRegistry();
    reg.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    reg.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
    reg.setDefault('Dev');
    expect(reg.getDefaultWiki()?.name).toBe('Dev');
  });

  it('throws when setting default to unknown wiki', () => {
    const reg = new WikiRegistry();
    expect(() => reg.setDefault('Nope')).toThrow('not registered');
  });

  it('returns undefined for getDefaultWiki when empty', () => {
    const reg = new WikiRegistry();
    expect(reg.getDefaultWiki()).toBeUndefined();
  });

  describe('fromEnvironment', () => {
    it('parses MEDIAWIKI_WIKIS with tokens', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_WIKIS: 'Sales:https://sales.wiki.com,Dev:https://dev.wiki.com',
        MEDIAWIKI_API_TOKEN_SALES: 'token1',
        MEDIAWIKI_API_TOKEN_DEV: 'token2',
      });
      expect(reg.getAllWikis()).toHaveLength(2);
      expect(reg.getWiki('Sales')).toEqual({
        name: 'Sales',
        baseUrl: 'https://sales.wiki.com',
        apiToken: 'token1',
      });
      expect(reg.getWiki('Dev')).toEqual({
        name: 'Dev',
        baseUrl: 'https://dev.wiki.com',
        apiToken: 'token2',
      });
      // First wiki is default
      expect(reg.getDefaultWiki()?.name).toBe('Sales');
    });

    it('respects MEDIAWIKI_DEFAULT_WIKI', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_WIKIS: 'Sales:https://sales.wiki.com,Dev:https://dev.wiki.com',
        MEDIAWIKI_DEFAULT_WIKI: 'Dev',
      });
      expect(reg.getDefaultWiki()?.name).toBe('Dev');
    });

    it('falls back to MEDIAWIKI_BASE_URL', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_BASE_URL: 'https://my.wiki.com',
        MEDIAWIKI_API_TOKEN: 'mytoken',
      });
      expect(reg.getAllWikis()).toHaveLength(1);
      expect(reg.getWiki('default')).toEqual({
        name: 'default',
        baseUrl: 'https://my.wiki.com',
        apiToken: 'mytoken',
      });
    });

    it('falls back to MEDIAWIKI_BASE_URL without token', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_BASE_URL: 'https://my.wiki.com',
      });
      expect(reg.getWiki('default')).toEqual({
        name: 'default',
        baseUrl: 'https://my.wiki.com',
      });
    });

    it('throws when no config is found', () => {
      expect(() => WikiRegistry.fromEnvironment({})).toThrow('No wiki configuration found');
    });

    it('handles URLs with colons correctly', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_WIKIS: 'Sales:https://sales.wiki.com:8443/w',
      });
      expect(reg.getWiki('Sales')).toEqual({
        name: 'Sales',
        baseUrl: 'https://sales.wiki.com:8443/w',
      });
    });
  });
});
