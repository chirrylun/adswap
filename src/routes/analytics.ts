// src/routes/analytics.ts
import { Router, Response } from "express";
import { adminAuth, AdminRequest } from "../middleware/auth";
import { adminLimiter } from "../middleware/rateLimiter";
import AnalyticsEvent from "../models/AnalyticsEvent";
import MessageLog from "../models/MessageLog";

const router = Router();

router.use(adminLimiter);

// ─── Helper ───────────────────────────────────────────────────────────────────
function since(days: any): Date {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
}

// ── Funnel — all events rolled up ────────────────────────────────────────────
router.get("/funnel", adminAuth, async (req: AdminRequest, res: Response) => {
  const d = since(req.query.days ?? 30);

  const counts = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: d } } },
    { $group: { _id: "$event", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.json({ since: d, counts });
});

// ── Drop-off breakdown ────────────────────────────────────────────────────────
router.get("/dropoffs", adminAuth, async (req: AdminRequest, res: Response) => {
  const d = since(req.query.days ?? 30);

  const dropoffs = await AnalyticsEvent.aggregate([
    { $match: { event: "drop_off", createdAt: { $gte: d } } },
    { $group: { _id: "$sessionStep", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.json({ since: d, dropoffs });
});

// ── Sell funnel ───────────────────────────────────────────────────────────────
router.get(
  "/sell-funnel",
  adminAuth,
  async (req: AdminRequest, res: Response) => {
    const d = since(req.query.days ?? 30);

    const SELL_STEPS = [
      "sell_started",
      "sell_type_selected",
      "sell_price_set",
      "sell_escrow_selected",
      "sell_listing_created",
    ];

    const counts = await AnalyticsEvent.aggregate([
      { $match: { event: { $in: SELL_STEPS }, createdAt: { $gte: d } } },
      {
        $group: {
          _id: "$event",
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: "$phone" },
        },
      },
      {
        $project: { _id: 1, count: 1, uniqueUsers: { $size: "$uniqueUsers" } },
      },
    ]);

    const funnel = SELL_STEPS.map((step) => {
      const found = counts.find((c: any) => c._id === step);
      return {
        step,
        count: found?.count ?? 0,
        uniqueUsers: found?.uniqueUsers ?? 0,
      };
    });

    res.json({ since: d, funnel });
  },
);

// ── Most viewed listings ──────────────────────────────────────────────────────
router.get("/listings", adminAuth, async (req: AdminRequest, res: Response) => {
  const d = since(req.query.days ?? 30);

  const views = await AnalyticsEvent.aggregate([
    { $match: { event: "listing_viewed", createdAt: { $gte: d } } },
    {
      $group: {
        _id: "$meta.listingId",
        views: { $sum: 1 },
        type: { $first: "$meta.type" },
      },
    },
    { $sort: { views: -1 } },
    { $limit: 20 },
  ]);

  res.json({ since: d, views });
});

// ── Category popularity ───────────────────────────────────────────────────────
router.get(
  "/categories",
  adminAuth,
  async (req: AdminRequest, res: Response) => {
    const d = since(req.query.days ?? 30);

    const categories = await AnalyticsEvent.aggregate([
      { $match: { event: "category_selected", createdAt: { $gte: d } } },
      { $group: { _id: "$meta.category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({ since: d, categories });
  },
);

// ── Daily active users ────────────────────────────────────────────────────────
router.get("/dau", adminAuth, async (req: AdminRequest, res: Response) => {
  const d = since(req.query.days ?? 30);

  const dau = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: d } } },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          phone: "$phone",
        },
      },
    },
    { $group: { _id: "$_id.date", activeUsers: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  res.json({ since: d, dau });
});

// ── Broadcast open rate ───────────────────────────────────────────────────────
// Overall: GET /analytics/open-rate?days=30&category=new_listing
// Per listing: GET /analytics/open-rate?days=30&listingId=ADS-4821
router.get(
  "/open-rate",
  adminAuth,
  async (req: AdminRequest, res: Response) => {
    const d = since(req.query.days ?? 30);
    const category = req.query.category as string | undefined;
    const listingId = req.query.listingId as string | undefined;

    // Build filter — refId takes priority (per-listing query)
    const baseFilter: any = { sentAt: { $gte: d } };
    if (listingId) baseFilter.refId = listingId;
    else if (category) baseFilter.category = category;
    else baseFilter.category = "new_listing"; // sensible default

    const [sent, delivered, read, failed, avgTtRead] = await Promise.all([
      MessageLog.countDocuments(baseFilter),
      MessageLog.countDocuments({
        ...baseFilter,
        status: { $in: ["delivered", "read"] },
      }),
      MessageLog.countDocuments({ ...baseFilter, status: "read" }),
      MessageLog.countDocuments({ ...baseFilter, status: "failed" }),

      // Average time-to-read in seconds across all read messages
      MessageLog.aggregate([
        {
          $match: {
            ...baseFilter,
            status: "read",
            readAt: { $exists: true },
          },
        },
        {
          $project: {
            ttReadSeconds: {
              $divide: [{ $subtract: ["$readAt", "$sentAt"] }, 1000],
            },
          },
        },
        { $group: { _id: null, avg: { $avg: "$ttReadSeconds" } } },
      ]),
    ]);

    // Per-category breakdown (only when not filtering by listingId)
    let byCategory: any[] = [];
    if (!listingId) {
      byCategory = await MessageLog.aggregate([
        { $match: { sentAt: { $gte: d } } },
        {
          $group: {
            _id: "$category",
            sent: { $sum: 1 },
            read: { $sum: { $cond: [{ $eq: ["$status", "read"] }, 1, 0] } },
            delivered: {
              $sum: {
                $cond: [{ $in: ["$status", ["delivered", "read"]] }, 1, 0],
              },
            },
          },
        },
        {
         $addFields: {
  openRate: {
    $cond: [
      { $gt: ['$delivered', 0] },
      { $multiply: [{ $divide: ['$read', '$delivered'] }, 100] },
      0,
    ],
  },
},
        },
        { $sort: { sent: -1 } },
      ]);
    }

    // Top listings by open rate (only for new_listing category, min 10 sent)
    let topListings: any[] = [];
    if (!listingId && (!category || category === "new_listing")) {
      topListings = await MessageLog.aggregate([
        { $match: { ...baseFilter, refId: { $exists: true } } },
        {
  $group: {
    _id:       '$refId',
    sent:      { $sum: 1 },
    delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read']] }, 1, 0] } },
    read:      { $sum: { $cond: [{ $eq: ['$status', 'read'] }, 1, 0] } },
  },
},
{ $match: { sent: { $gte: 10 } } },
{
  $addFields: {
    openRate: {
      $cond: [
        { $gt: ['$delivered', 0] },
        { $multiply: [{ $divide: ['$read', '$delivered'] }, 100] },
        0,
      ],
    },
  },
},
        { $sort: { openRate: -1 } },
        { $limit: 10 },
      ]);
    }

    const deliveryRate =
      sent > 0 ? ((delivered / sent) * 100).toFixed(1) : "0.0";

    const openRate =
      delivered > 0 ? ((read / delivered) * 100).toFixed(1) : "0.0";
    const avgTtReadSec = avgTtRead[0]?.avg ?? null;

    res.json({
      since: d,
      filter: {
        category: listingId ? undefined : (category ?? "new_listing"),
        listingId,
      },
      summary: {
        sent,
        delivered,
        read,
        failed,
        deliveryRate: `${deliveryRate}%`,
        openRate: `${openRate}%`,
        avgTtReadMin:
          avgTtReadSec !== null ? Math.round(avgTtReadSec / 60) : null,
      },
      byCategory, // [] when listingId filter active
      topListings, // [] when listingId filter active
    });
  },
);

export default router;
