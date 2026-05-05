import { sendButtons } from '../../services/whatsapp';
import { clearSession } from '../session';

export async function showWelcome(phone: string): Promise<void> {
  await clearSession(phone);
  await sendButtons(
    phone,
    `👋 Welcome to *AdSwap*\n\n` +
    `Nigeria's trusted escrow marketplace for AdSense accounts and monetised digital assets.\n\n` +
    `✅ Verified listings only\n` +
    `🔒 Escrow-protected payments\n` +
    `⚡ 48hr dispute resolution\n\n` +
    `What would you like to do?`,
    [
      { id: 'SELL',     title: '💰 Sell a digital asset' },
      { id: 'LISTINGS', title: '🔍 Browse verified listings'  },
      { id: 'HELP',     title: '❓ Help'              },
    ]
  );
}

export async function showHelp(phone: string): Promise<void> {
  await sendButtons(
    phone,
    `*AdSwap Commands* 📖\n\n` +
    `*SELL* — List your account for sale\n` +
    `*LISTINGS* — Browse verified listings\n` +
    `*BUY [ID]* — Buy a specific listing\n` +
    `*CONFIRM [TXN]* — Confirm account transfer\n` +
    `*DISPUTE [TXN]* — Raise a dispute\n` +
    `*READY [TXN]* — Seller: signal transfer start\n` +
    `*CANCEL* — Cancel current action\n` +
    `*MENU* — Return to main menu\n\n` +
    `Support: ${process.env.SUPPORT_PHONE}`,
    [
      { id: 'SELL',     title: '💰 Sell'    },
      { id: 'LISTINGS', title: '🔍 Browse'  },
      { id: 'MENU',     title: '🏠 Menu'    },
    ]
  );
}