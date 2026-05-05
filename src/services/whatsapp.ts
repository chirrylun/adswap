// src/services/whatsapp.ts
import axios, { AxiosInstance } from 'axios';

const VERSION = process.env.META_API_VERSION || 'v19.0';
const PHONE   = process.env.META_PHONE_NUMBER_ID!;
const TOKEN   = process.env.META_ACCESS_TOKEN!;

// Create axios instance with defaults
const metaClient: AxiosInstance = axios.create({
  baseURL: `https://graph.facebook.com/${VERSION}`,
  headers: {
    Authorization:  `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Retry wrapper — Meta API occasionally returns 5xx
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries === 0) throw err;
    const isRetryable = err?.response?.status >= 500 ||
                        err?.code === 'ECONNRESET';
    if (!isRetryable) throw err;
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// ─── Send plain text ──────────────────────────────────────────────────────────
export async function sendMessage(to: string, text: string): Promise<void> {
  await withRetry(() =>
    metaClient.post(`/${PHONE}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'text',
      text: {
        body:        text,
        preview_url: false,
      },
    })
  );
}

// ─── Send interactive buttons (max 3 buttons) ─────────────────────────────────
export async function sendButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[],
  header?: string,
  footer?: string
): Promise<void> {
  if (buttons.length > 3) {
    throw new Error('WhatsApp buttons max is 3. Use sendList for more options.');
  }

  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map(b => ({
          type:  'reply',
          reply: {
            id:    b.id.slice(0, 256),    // Meta limit
            title: b.title.slice(0, 20),  // Meta limit
          },
        })),
      },
    },
  };

  if (header) payload.interactive.header = { type: 'text', text: header };
  if (footer) payload.interactive.footer = { text: footer };

  await withRetry(() => metaClient.post(`/${PHONE}/messages`, payload));
}

// ─── Send list menu (up to 10 items) ─────────────────────────────────────────
export async function sendList(
  to: string,
  body: string,
  buttonText: string,
  sections: {
    title: string;
    rows:  { id: string; title: string; description?: string }[];
  }[],
  header?: string,
  footer?: string
): Promise<void> {
  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button:   buttonText.slice(0, 20),
        sections: sections.map(s => ({
          title: s.title,
          rows:  s.rows.map(r => ({
            id:          r.id.slice(0, 256),
            title:       r.title.slice(0, 24),
            description: r.description?.slice(0, 72) || '',
          })),
        })),
      },
    },
  };

  if (header) payload.interactive.header = { type: 'text', text: header };
  if (footer) payload.interactive.footer = { text: footer };

  await withRetry(() => metaClient.post(`/${PHONE}/messages`, payload));
}

// ─── Mark message as read ─────────────────────────────────────────────────────
export async function markAsRead(messageId: string): Promise<void> {
  await withRetry(() =>
    metaClient.post(`/${PHONE}/messages`, {
      messaging_product: 'whatsapp',
      status:            'read',
      message_id:        messageId,
    })
  ).catch(() => {}); // Non-critical — don't fail if this errors
}

// ─── Download media sent by user ──────────────────────────────────────────────
export async function getMediaUrl(mediaId: string): Promise<string> {
  const res = await withRetry(() =>
    metaClient.get(`/${mediaId}`)
  );
  return res.data.url;
}

export async function downloadMedia(
  mediaUrl: string
): Promise<Buffer> {
  const res = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return Buffer.from(res.data);
}