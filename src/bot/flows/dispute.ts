/*
import { sendMessage, sendButtons } from '../../services/whatsapp';
import { setSession, updateSessionData, clearSession } from '../session';
import { uploadScreenshot } from '../../services/cloudinary';
import Dispute     from '../../models/Dispute';
import Transaction from '../../models/Transaction';
import User        from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

const REASON_MAP: Record<string, string> = {
  '1': 'account_not_accessible',
  '2': 'account_suspended',
  '3': 'details_mismatch',
  '4': 'seller_unresponsive',
  '5': 'other',
};

const REASON_LABELS: Record<string, string> = {
  account_not_accessible: 'Account not accessible',
  account_suspended:      'Account suspended or banned',
  details_mismatch:       "Account doesn't match listing",
  seller_unresponsive:    'Seller not responding',
  other:                  'Other issue',
};

export async function handleDispute(
  phone:   string,
  text:    string,
  session: ISession,
  mediaId?: string
): Promise<void> {
  const step = session.step;
  const data = session.data;

  // ── Entry: DISPUTE TXN-XXXXX ───────────────────────────────────────────────
  if (text.startsWith('DISPUTE ') || text === 'DISPUTE') {
    const txnId = text.replace('DISPUTE ', '').trim();

    if (!txnId || txnId === 'DISPUTE') {
      return sendMessage(phone,
        'To raise a dispute, reply:\n*DISPUTE [Transaction ID]*\n\nExample: DISPUTE TXN-ABC123'
      );
    }

    const user = await User.findOne({ phone });
    const txn  = await Transaction.findOne({
      transactionId: txnId,
      $or: [{ buyer: user?._id }, { seller: user?._id }],
    });

    if (!txn) {
      return sendMessage(phone, '❌ Transaction not found. Check the ID and try again.');
    }

    if (txn.status === 'completed') {
      return sendMessage(phone, '❌ This transaction has already been completed and confirmed.');
    }

    if (txn.status === 'disputed') {
      return sendMessage(phone,
        `⚠️ A dispute is already open for this transaction.\n\n` +
        `Our team will respond within ${process.env.DISPUTE_RESPONSE_HOURS || 4} hours.`
      );
    }

    // Freeze escrow
    txn.status          = 'disputed';
    txn.disputeRaisedAt = new Date();
    await txn.save();

    await setSession(phone, 'dispute_reason', { txnId });

    return sendMessage(phone,
      `🔒 *Escrow frozen for transaction ${txnId}*\n\n` +
      `What is the issue?\n\n` +
      `1️⃣  Account not accessible\n` +
      `2️⃣  Account is suspended or banned\n` +
      `3️⃣  Account doesn't match the listing\n` +
      `4️⃣  Seller is not responding\n` +
      `5️⃣  Other issue\n\n` +
      `Reply with a number (1–5):`
    );
  }

  // ── Select reason ──────────────────────────────────────────────────────────
  if (step === 'dispute_reason') {
    const reasonKey = REASON_MAP[text];
    if (!reasonKey) {
      return sendMessage(phone, '❌ Please reply with a number from 1 to 5.');
    }
    await updateSessionData(phone, { reason: reasonKey });
    await setSession(phone, 'dispute_description', { ...data, reason: reasonKey });
    return sendMessage(phone,
      `✅ Reason: *${REASON_LABELS[reasonKey]}*\n\n` +
      `Describe what happened in detail.\n\n` +
      `Include:\n` +
      `— What you tried\n` +
      `— What error or problem you saw\n` +
      `— When it happened\n\n` +
      `Type your description:`
    );
  }

  // ── Collect description ────────────────────────────────────────────────────
  if (step === 'dispute_description') {
    await setSession(phone, 'dispute_evidence', { ...data, description: text, evidence: [] });
    return sendMessage(phone,
      `✅ Description saved.\n\n` +
      `Send any *evidence screenshots* to support your dispute (optional).\n\n` +
      `Type *SUBMIT* to submit without evidence, or send images first.`
    );
  }

  // ── Collect evidence ───────────────────────────────────────────────────────
  if (step === 'dispute_evidence') {
    if (mediaId) {
      try {
        const url      = await uploadScreenshot(mediaId, `disputes/${phone}`);
        const evidence = [...(data.evidence || []), url];
        await updateSessionData(phone, { evidence });
        return sendMessage(phone,
          `✅ Evidence ${evidence.length} received.\n\n` +
          `Send more or type *SUBMIT* to submit your dispute.`
        );
      } catch {
        return sendMessage(phone, '❌ Upload failed. Try again or type *SUBMIT* to proceed.');
      }
    }

    if (text === 'SUBMIT') {
      const user      = await User.findOne({ phone });
      const disputeId = `DIS-${generateId(5)}`;

      await Dispute.create({
        disputeId,
        transaction:  await Transaction.findOne({ transactionId: data.txnId }).then(t => t?._id),
        raisedBy:     user?._id,
        reason:       data.reason,
        description:  data.description,
        evidenceUrls: data.evidence || [],
        status:       'open',
      });

      await clearSession(phone);

      // Alert admin
      await import('../../services/whatsapp').then(({ sendMessage: sm }) =>
        sm(
          process.env.SUPPORT_PHONE!,
          `🚨 *New Dispute Raised*\n\n` +
          `Dispute ID: ${disputeId}\n` +
          `Transaction: ${data.txnId}\n` +
          `Raised by: ${phone}\n` +
          `Reason: ${REASON_LABELS[data.reason]}\n\n` +
          `Escrow is frozen. Review in admin dashboard.`
        )
      );

      return sendMessage(phone,
        `✅ *Dispute Submitted*\n\n` +
        `Dispute ID: *${disputeId}*\n\n` +
        `🔒 Escrow remains frozen until resolved.\n` +
        `Our team will respond within *4 business hours*.\n\n` +
        `Keep this ID for reference.\n` +
        `Support: ${process.env.SUPPORT_PHONE}`
      );
    }

    return sendMessage(phone, 'Send a screenshot or type *SUBMIT* to submit your dispute.');
  }
}
  */