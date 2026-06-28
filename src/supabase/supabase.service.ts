import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin PostgREST client over the Supabase REST API, mirroring the
 * fetch-with-service-key pattern already used in bundles.service.ts and
 * analysis.service.ts. Centralised here so the Hakim module and the user-JWT
 * guard don't each re-implement the same headers/error handling.
 *
 * `query` strings are raw PostgREST query params, e.g.
 *   `userID=eq.42&select=session_token`
 */
@Injectable()
export class SupabaseService {
  private readonly restUrl: string;
  private readonly key: string;

  constructor(configService: ConfigService) {
    this.restUrl = `${configService.getOrThrow<string>('SUPABASE_URL')}/rest/v1`;
    this.key = configService.getOrThrow<string>('SUPABASE_SERVICE_KEY');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      ...extra,
    };
  }

  /** Call a Postgres function. Returns the parsed JSON (scalar, object, or array). */
  async rpc<T = any>(fn: string, args: Record<string, any>): Promise<T> {
    const res = await fetch(`${this.restUrl}/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(`RPC ${fn} failed: ${detail}`);
    }
    return (await res.json()) as T;
  }

  /** SELECT rows. Always returns an array (possibly empty). */
  async select<T = any>(table: string, query: string): Promise<T[]> {
    const res = await fetch(`${this.restUrl}/${table}?${query}`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(
        `Select ${table} failed: ${detail}`,
      );
    }
    return (await res.json()) as T[];
  }

  /** Convenience: first matching row or null. */
  async selectOne<T = any>(table: string, query: string): Promise<T | null> {
    const rows = await this.select<T>(table, query);
    return rows[0] ?? null;
  }

  /** Count rows matching a query using PostgREST's exact count header. */
  async count(table: string, query: string): Promise<number> {
    const res = await fetch(`${this.restUrl}/${table}?${query}`, {
      method: 'GET',
      headers: this.headers({ Prefer: 'count=exact', Range: '0-0' }),
    });
    if (!res.ok && res.status !== 206) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(
        `Count ${table} failed: ${detail}`,
      );
    }
    // Content-Range looks like "0-0/123" (or "*/123" when empty)
    const contentRange = res.headers.get('content-range') ?? '';
    const total = contentRange.split('/')[1];
    return total ? parseInt(total, 10) : 0;
  }

  /** INSERT a single row. Returns the created row when `returning` is true. */
  async insert<T = any>(
    table: string,
    row: Record<string, any>,
    returning = false,
  ): Promise<T | null> {
    const res = await fetch(`${this.restUrl}/${table}`, {
      method: 'POST',
      headers: this.headers({
        Prefer: returning ? 'return=representation' : 'return=minimal',
      }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(
        `Insert ${table} failed: ${detail}`,
      );
    }
    if (!returning) return null;
    const data = (await res.json()) as T[];
    return data[0] ?? null;
  }

  /** Bulk INSERT (one request, many rows). Used for lecture chunk batches. */
  async insertMany(table: string, rows: Record<string, any>[]): Promise<void> {
    if (rows.length === 0) return;
    const res = await fetch(`${this.restUrl}/${table}`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(
        `Bulk insert ${table} failed: ${detail}`,
      );
    }
  }

  /** PATCH rows matching the query. */
  async update(
    table: string,
    query: string,
    patch: Record<string, any>,
  ): Promise<void> {
    const res = await fetch(`${this.restUrl}/${table}?${query}`, {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(
        `Update ${table} failed: ${detail}`,
      );
    }
  }

  /** DELETE rows matching the query. */
  async delete(table: string, query: string): Promise<void> {
    const res = await fetch(`${this.restUrl}/${table}?${query}`, {
      method: 'DELETE',
      headers: this.headers({ Prefer: 'return=minimal' }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new InternalServerErrorException(
        `Delete ${table} failed: ${detail}`,
      );
    }
  }
}
