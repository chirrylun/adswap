export const LISTING_FEES: Record<string, number> = {
  verified_adsense:          3000,
  payment_received_adsense:  5000,
  website_bundle:            8000,
  youtube_channel:           5000,
};

export const FEE_TIERS = [
  { max: 300000,   rate: 0.08 },
  { max: 1000000,  rate: 0.06 },
  { max: Infinity, rate: 0.04 },
];

export const LISTING_EXPIRY_DAYS    = 30;
export const TRANSFER_WINDOW_HOURS  = 12;
export const CONFIRM_WINDOW_HOURS   = 48;
export const DISPUTE_RESPONSE_HOURS = 4;

export const TYPE_MAP: Record<string, string> = {
  '1': 'verified_adsense',
  '2': 'payment_received_adsense',
  '3': 'website_bundle',
  '4': 'youtube_channel',
};

export const TYPE_LABELS: Record<string, string> = {
  verified_adsense:          'Verified AdSense',
  payment_received_adsense:  'Payment-Received AdSense',
  website_bundle:            'Website Bundle',
  youtube_channel:           'YouTube Channel',
};

export const SESSION_STEPS = {
  IDLE:               'idle',
  SELL_TYPE:          'sell_type',
  SELL_PRICE:         'sell_price',
  SELL_NICHE:         'sell_niche',
  SELL_DESC:          'sell_description',
  SELL_SCREENSHOTS:   'sell_screenshots',
  BUY_AWAITING:       'buy_awaiting_payment',
  DISPUTE_TXN:        'dispute_txn',
  DISPUTE_REASON:     'dispute_reason',
  RATE_TXN:           'rate_txn',
} as const;