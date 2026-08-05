import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionContext } from './tools/index.js';

export interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  context: SessionContext;
  /** Wiki `sub` that initialized this session (OAuth mode only). */
  sub?: string;
}

export interface SessionRegistryOptions {
  /** Idle time after which a session with no activity is reclaimed. */
  idleTtlMs: number;
  /** Hard cap on concurrent sessions; see atCapacity(). */
  maxSessions: number;
  /** How often the periodic sweep checks for idle sessions. */
  sweepIntervalMs?: number;
}

export const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_SESSIONS = 1000;
export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

interface Entry {
  session: Session;
  lastSeen: number;
}

/**
 * Bounds the lifetime of HTTP transport sessions so a crashed/dropped client
 * (which never fires transport.onclose) can't pin its Session — and the
 * per-wiki RestClients/cookie jars it holds — in memory forever.
 */
export class SessionRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(options: SessionRegistryOptions) {
    this.idleTtlMs = options.idleTtlMs;
    this.maxSessions = options.maxSessions;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  get size(): number {
    return this.entries.size;
  }

  atCapacity(): boolean {
    return this.entries.size >= this.maxSessions;
  }

  set(id: string, session: Session): void {
    this.entries.set(id, { session, lastSeen: Date.now() });
  }

  /** Returns the session, touching lastSeen — or undefined if missing or idle-expired. */
  get(id: string): Session | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.evict(id, entry);
      return undefined;
    }
    entry.lastSeen = Date.now();
    return entry.session;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  private isExpired(entry: Entry): boolean {
    return Date.now() - entry.lastSeen > this.idleTtlMs;
  }

  private evict(id: string, entry: Entry): void {
    this.entries.delete(id);
    void entry.session.transport.close().catch(() => {});
  }

  /** Reclaims every idle-expired session. Runs on the periodic timer; safe to call directly. */
  sweep(): void {
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.evict(id, entry);
      }
    }
  }

  /** Idempotent: a second call is a no-op while a sweep timer is already running. */
  startSweep(): void {
    if (this.sweepTimer) return;
    const timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    timer.unref?.();
    this.sweepTimer = timer;
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }
}
