// src/services/analytics.ts
import AnalyticsEvent from '../models/AnalyticsEvent';

export async function track(
  event: string,
  phone: string,
  meta?: Record<string, any>,
  sessionStep?: string,
): Promise<void> {
  // Fire-and-forget — never block the bot response
  AnalyticsEvent.create({ event, phone, meta, sessionStep }).catch(err =>
    console.error('[Analytics] Track error:', err?.message ?? err),
  );
}