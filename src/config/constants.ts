export const LISTING_FEES: Record<string, number> = {
  google_ad_account:   1500,  // competitive, high volume listing type
  facebook_ad_account: 1500,
  adsense_site:        2000,  // slightly higher, more complex to verify
  play_console:        2000,
  gift_card:           500,   // low barrier, low-effort listing
};

export const FEE_TIERS = [
  { max: 30_000,     rate: 0.08 }, // 8%  — gift cards, low-value accounts
  { max: 100_000,    rate: 0.07 }, // 7%  — mid-low, most common range
  { max: 300_000,    rate: 0.06 }, // 6%  — mid-high accounts
  { max: 700_000,    rate: 0.05 }, // 5%  — premium listings
  { max: Infinity,   rate: 0.04 }, // 4%  — high-value, retain big sellers
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