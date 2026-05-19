import { sendButtons, sendMessage } from '../../services/whatsapp';
import { clearSession } from '../session';

export async function showWelcome(phone: string): Promise<void> {
  await clearSession(phone);
  await sendButtons(
    phone,
    `👋 Welcome to *Swappa*\n\n` +
    `The safest way to buy and sell digital accounts in Nigeria.\n\n` +
    `Whether you're selling a Google Ads account, TikTok page, Instagram account, Play Console, gift cards and more — we've got you covered.\n\n` +
    `🔒 *Your money is always protected*\n` +
    `Every transaction goes through *Koji Agudah*, *Nauman Chaudhary* or *Swappa's native escrow* — funds are held safely and only released when you confirm you've received full access.\n\n` +
    `✅ Every listing is manually verified before going live\n` +
    `⚡ Disputes resolved within 48 hours\n` +
    `💬 Real support when you need it\n\n` +
    `What would you like to do?`,
    [
      { id: 'SELL',     title: '💰 Sell an asset'   },
      { id: 'LISTINGS', title: '🔍 Browse listings'  },
      { id: 'HELP',     title: '❓ How it works'     },
    ]
  );
}

export async function showHelp(phone: string): Promise<void> {
  await sendMessage(
    phone,
    `*How Swappa Works* 🛡️\n\n` +
    `*Buying an account?*\n` +
    `1. Browse listings and find what you want\n` +
    `2. Send *BUY [listing ID]* to start\n` +
    `3. Our team contacts you to set up escrow\n` +
    `4. Your money is held safely — not sent to the seller yet\n` +
    `5. Seller hands over the account credentials\n` +
    `6. You confirm access and funds are released to the seller\n\n` +
    `*Selling an account?*\n` +
    `1. Type *SELL* and follow the steps\n` +
    `2. Send verification screenshots\n` +
    `3. We review and publish your listing within 24 hours\n` +
    `4. When a buyer is ready, escrow handles the payment\n` +
    `5. You get paid once the buyer confirms access\n\n` +
    `*Useful commands*\n` +
    `*LISTINGS* — Browse what's available\n` +
    `*SELL* — List an asset for sale\n` +
    `*REQUEST* — Ask for a specific asset\n` +
    `*MY LISTINGS* — View your active listings\n` +
    `*MENU* — Return to the main menu\n\n` +
    `🔒 All payments go through escrow — your money is never at risk.\n\n` +
    `💬 *Have a question? Chat with us directly:*\n` +
    `https://wa.me/2347026131523\n\n` +
    `🌐 *Learn more:* www.swappa.chat`
  );

  await sendButtons(
    phone,
    `What would you like to do next?`,
    [
      { id: 'SELL',     title: '💰 Sell'   },
      { id: 'LISTINGS', title: '🔍 Browse' },
      { id: 'MENU',     title: '🏠 Menu'   },
    ]
  );
}