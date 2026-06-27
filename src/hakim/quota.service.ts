import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';

export type QuotaMode = 'free' | 'charged' | 'insufficient';

export interface QuotaDecision {
  mode: QuotaMode;
  cost: number;
  usesToday: number;
  freeLimit: number;
  /** New balance after a successful deduction (charged mode only). */
  newPoints?: number;
}

/**
 * Usage gating for Hakim. Each user gets a configurable number of free uses per
 * day; beyond that, every use spends points via the atomic deduct_points RPC —
 * the same primitive the bank-buy flow uses. Decisions are made BEFORE
 * generation; the caller records the transaction/activity only after a
 * successful answer and refunds (add_points) if generation fails.
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  private readonly freeLimit: number;
  private readonly costPerUse: number;
  private readonly tzOffsetHours: number;

  constructor(
    configService: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.freeLimit = parseInt(
      configService.get<string>('HAKIM_FREE_DAILY_LIMIT') ?? '10',
      10,
    );
    this.costPerUse = parseInt(
      configService.get<string>('HAKIM_POINTS_PER_USE') ?? '5',
      10,
    );
    this.tzOffsetHours = parseInt(
      configService.get<string>('HAKIM_QUOTA_TZ_OFFSET_HOURS') ?? '3',
      10,
    );
  }

  /** UTC ISO instant corresponding to local midnight today (per configured TZ). */
  private startOfTodayISO(): string {
    const offsetMs = this.tzOffsetHours * 3600_000;
    const local = new Date(Date.now() + offsetMs);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - offsetMs).toISOString();
  }

  /** Number of completed Hakim responses for this user since local midnight. */
  async usesToday(userID: number | string): Promise<number> {
    return this.supabase.count(
      'hawi_hakim_message',
      `userID=eq.${encodeURIComponent(String(userID))}` +
        `&role=eq.assistant&created_at=gte.${this.startOfTodayISO()}`,
    );
  }

  /**
   * Decide whether this use is free or must be paid, deducting points up front
   * when paid (so we never hand out a paid answer for free).
   */
  async check(userID: number | string): Promise<QuotaDecision> {
    const usesToday = await this.usesToday(userID);

    if (usesToday < this.freeLimit) {
      return { mode: 'free', cost: 0, usesToday, freeLimit: this.freeLimit };
    }

    const newPoints = await this.supabase.rpc<number | null>('deduct_points', {
      p_user_id: userID,
      p_amount: this.costPerUse,
    });

    if (newPoints === null || newPoints === undefined) {
      return {
        mode: 'insufficient',
        cost: this.costPerUse,
        usesToday,
        freeLimit: this.freeLimit,
      };
    }

    return {
      mode: 'charged',
      cost: this.costPerUse,
      usesToday,
      freeLimit: this.freeLimit,
      newPoints,
    };
  }

  /** Refund a previously deducted charge (e.g. generation failed mid-stream). */
  async refund(userID: number | string, amount: number): Promise<void> {
    if (amount <= 0) return;
    try {
      await this.supabase.rpc('add_points', {
        p_user_id: userID,
        p_amount: amount,
      });
    } catch (err: any) {
      this.logger.error(`Refund failed for user ${userID}: ${err?.message}`);
    }
  }

  /**
   * Record a completed use: a transaction row when paid, and an activity row
   * always (for usage analytics). Fire-and-forget — never blocks the response.
   */
  async recordUsage(
    userID: number | string,
    charged: number,
    note?: string,
  ): Promise<void> {
    try {
      if (charged > 0) {
        await this.supabase.insert('hawi_transaction', {
          type: 'hakim_usage',
          userID,
          user_delta: -charged,
          note: note ?? 'Hakim usage',
        });
      }
      await this.supabase.insert('hawi_activity', {
        userID,
        type: 'hakim_usage',
        metadata: { charged_points: charged },
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to record Hakim usage for user ${userID}: ${err?.message}`,
      );
    }
  }
}
