import {DurableObject} from 'cloudflare:workers';

export class IpRateLimitDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS counters (action TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL)');
    });
  }

  consume(action, limit, windowMs) {
    const now = Date.now();
    const row = this.ctx.storage.sql.exec('SELECT started_at, count FROM counters WHERE action = ?', action).toArray()[0];
    if (!row || now - row.started_at >= windowMs) {
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO counters (action, started_at, count) VALUES (?, ?, 1)', action, now);
      return true;
    }
    if (row.count >= limit) return false;
    this.ctx.storage.sql.exec('UPDATE counters SET count = count + 1 WHERE action = ?', action);
    return true;
  }
}
