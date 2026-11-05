import type { Response } from 'express';
import type { StreamEvent } from './views/contract';
import { wireReplacer } from './json';

/** Server-sent events: one stream per browser; the browser refetches views when told something changed. */
export class EventBus {
  private clients = new Set<Response>();
  private beat?: NodeJS.Timeout;

  add(res: Response, hello: StreamEvent): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    this.clients.add(res);
    this.send(res, hello);
    res.on('close', () => this.clients.delete(res));
    this.beat ??= setInterval(() => {
      for (const c of this.clients) c.write(': keep-alive\n\n');
    }, 15_000);
  }

  emit(e: StreamEvent): void {
    for (const c of this.clients) this.send(c, e);
  }

  private send(res: Response, e: StreamEvent): void {
    res.write(`event: ${e.type}\ndata: ${JSON.stringify(e, wireReplacer)}\n\n`);
  }

  size(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.beat) clearInterval(this.beat);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
