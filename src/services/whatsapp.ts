// src/services/whatsapp.ts
import axios, { AxiosInstance } from 'axios';
import MessageLog, { MessageCategory } from '../models/MessageLog';

const VERSION = process.env.META_API_VERSION || 'v19.0';
const PHONE   = process.env.META_PHONE_NUMBER_ID!;
const TOKEN   = process.env.META_ACCESS_TOKEN!;

const metaClient: AxiosInstance = axios.create({
  baseURL: `https://graph.facebook.com/${VERSION}`,
  headers: {
    Authorization:  `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// ─── Retry wrapper ────────────────────────────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries === 0) throw err;
    const isRetryable = err?.response?.status >= 500 || err?.code === 'ECONNRESET';
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
      text: { body: text, preview_url: false },
    }),
  );
}

// ─── Send tracked — use for broadcasts you want open-rate data on ─────────────
// Returns the wamid so the caller can store it if needed, but also
// auto-persists a MessageLog entry with category + optional refId.
export async function sendTracked(
  to:       string,
  text:     string,
  category: MessageCategory,
  refId?:   string,           // e.g. listingId, transactionId
): Promise<string | null> {
  try {
    const res = await withRetry(() =>
      metaClient.post(`/${PHONE}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'text',
        text: { body: text, preview_url: false },
      }),
    );

    const wamid: string | undefined = res.data?.messages?.[0]?.id;
    if (!wamid) return null;

    // Fire-and-forget — never block the send path
    MessageLog.create({ wamid, to, category, refId, status: 'sent', sentAt: new Date() })
      .catch(err => console.error('[MessageLog] Create error:', err?.message));

    return wamid;
  } catch (err) {
    console.error('[sendTracked] Failed to send to', to, err);
    return null;
  }
}

// ─── Send interactive buttons (max 3) ────────────────────────────────────────
export async function sendButtons(
  to:      string,
  body:    string,
  buttons: { id: string; title: string }[],
  header?: string,
  footer?: string,
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
          reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
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
  to:          string,
  body:        string,
  buttonText:  string,
  sections:    { title: string; rows: { id: string; title: string; description?: string }[] }[],
  header?:     string,
  footer?:     string,
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

// ─── Send image by URL ────────────────────────────────────────────────────────
export async function sendImage(
  to:       string,
  url:      string,
  caption?: string,
): Promise<void> {
  await withRetry(() =>
    metaClient.post(`/${PHONE}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type:  'image',
      image: { link: url, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
    }),
  );
}

export async function sendImageTracked(
  to:       string,
  imageUrl: string,
  caption:  string,
  category: MessageCategory,
  refId?:   string,
): Promise<string | null> {
  try {
    const res = await withRetry(() =>
      metaClient.post(`/${PHONE}/messages`, {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type:  'image',
        image: {
          link:    imageUrl,
          caption: caption.slice(0, 1024),
        },
      }),
    );
 
    const wamid: string | undefined = res.data?.messages?.[0]?.id;
    if (!wamid) return null;
 
    // Fire-and-forget — never block the send path
    MessageLog.create({ wamid, to, category, refId, status: 'sent', sentAt: new Date() })
      .catch(err => console.error('[MessageLog] Create error:', err?.message));
 
    return wamid;
  } catch (err) {
    console.error('[sendImageTracked] Failed to send to', to, err);
    return null;
  }
}

// ─── Mark message as read ─────────────────────────────────────────────────────
export async function markAsRead(messageId: string): Promise<void> {
  await withRetry(() =>
    metaClient.post(`/${PHONE}/messages`, {
      messaging_product: 'whatsapp',
      status:            'read',
      message_id:        messageId,
    }),
  ).catch(() => {}); // Non-critical
}

// ─── Download media sent by user ──────────────────────────────────────────────
export async function getMediaUrl(mediaId: string): Promise<string> {
  const res = await withRetry(() => metaClient.get(`/${mediaId}`));
  return res.data.url;
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const res = await axios.get(mediaUrl, {
    headers:      { Authorization: `Bearer ${TOKEN}` },
    responseType: 'arraybuffer',
    timeout:      30000,
  });
  return Buffer.from(res.data);
}