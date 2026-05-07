export const LISTING_FEES: Record<string, number> = {
  verified_adsense:          3000,
  payment_received_adsense:  5000,
  website_bundle:            8000,
  youtube_channel:           5000,
};

export const FEE_TIERS = [
  { max: 50_000,     rate: 0.10 }, // 10% for listings up to ₦50k
  { max: 200_000,    rate: 0.08 }, // 8%  for ₦50k–₦200k
  { max: 500_000,    rate: 0.06 }, // 6%  for ₦200k–₦500k
  { max: Infinity,   rate: 0.05 }, // 5%  for ₦500k+
];

export const LISTING_EXPIRY_DAYS    = 30;
export const TRANSFER_WINDOW_HOURS  = 12;
export const CONFIRM_WINDOW_HOURS   = 48;
export const DISPUTE_RESPONSE_HOURS = 4;

export const TYPE_MAP: Record<string, string> = {
  '1': 'google_ad_account',
  '2': 'facebook_ad_account',
  '3': 'adsense_site',
  '4': 'play_console',
  '5': 'gift_card',
};

export const TYPE_LABELS: Record<string, string> = {
  google_ad_account:   'Google Ads Account',
  facebook_ad_account: 'Facebook/Meta Ads Account',
  adsense_site:        'AdSense Monetised Site',
  play_console:        'Google Play Console Account',
  gift_card:           'Gift Card',
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