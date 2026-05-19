import { Router, Request, Response } from 'express';
import bcrypt    from 'bcryptjs';
import jwt       from 'jsonwebtoken';
import mongoose from 'mongoose';
import { adminAuth, AdminRequest } from '../middleware/auth';
import { adminLimiter } from '../middleware/rateLimiter';

import AnalyticsEvent from '../models/AnalyticsEvent';

const router = Router();

router.use(adminLimiter);

router.get('/funnel', adminAuth, async (req: AdminRequest, res: Response) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const counts = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$event', count: { $sum: 1 } } },
    { $sort:  { count: -1 } },
  ]);

  res.json({ since, counts });
});

// Drop-off breakdown — where users are getting lost
router.get('/dropoffs', adminAuth, async (req: AdminRequest, res: Response) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const dropoffs = await AnalyticsEvent.aggregate([
    { $match: { event: 'drop_off', createdAt: { $gte: since } } },
    { $group: { _id: '$sessionStep', count: { $sum: 1 } } },
    { $sort:  { count: -1 } },
  ]);

  res.json({ since, dropoffs });
});

// Sell funnel — how many users complete each sell step
router.get('/sell-funnel', adminAuth, async (req: AdminRequest, res: Response) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const SELL_STEPS = [
    'sell_started',
    'sell_type_selected',
    'sell_price_set',
    'sell_escrow_selected',
    'sell_listing_created',
  ];

  const counts = await AnalyticsEvent.aggregate([
    { $match: { event: { $in: SELL_STEPS }, createdAt: { $gte: since } } },
    { $group: { _id: '$event', count: { $sum: 1 }, uniqueUsers: { $addToSet: '$phone' } } },
    { $project: { _id: 1, count: 1, uniqueUsers: { $size: '$uniqueUsers' } } },
  ]);

  // Return in funnel order
  const ordered = SELL_STEPS.map(step => {
    const found = counts.find(c => c._id === step);
    return { step, count: found?.count ?? 0, uniqueUsers: found?.uniqueUsers ?? 0 };
  });

  res.json({ since, funnel: ordered });
});

// Most viewed listings
router.get('/listings', adminAuth, async (req: AdminRequest, res: Response) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const views = await AnalyticsEvent.aggregate([
    { $match: { event: 'listing_viewed', createdAt: { $gte: since } } },
    { $group: { _id: '$meta.listingId', views: { $sum: 1 }, type: { $first: '$meta.type' } } },
    { $sort: { views: -1 } },
    { $limit: 20 },
  ]);

  res.json({ since, views });
});

// Category popularity
router.get('/categories', adminAuth, async (req: AdminRequest, res: Response) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const categories = await AnalyticsEvent.aggregate([
    { $match: { event: 'category_selected', createdAt: { $gte: since } } },
    { $group: { _id: '$meta.category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  res.json({ since, categories });
});

// Daily active users
router.get('/dau', adminAuth, async (req: AdminRequest, res: Response) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const dau = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          date:  { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          phone: '$phone',
        },
      },
    },
    { $group: { _id: '$_id.date', activeUsers: { $sum: 1 } } },
    { $sort:  { _id: 1 } },
  ]);

  res.json({ since, dau });
});

export default router;