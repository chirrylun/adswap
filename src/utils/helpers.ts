import { v4 as uuidv4 } from 'uuid';

export function generateId(length: number = 6): string {
  return uuidv4().replace(/-/g, '').toUpperCase().slice(0, length);
}

export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`;
}

export function sanitizeText(text: string, maxLength: number = 500): string {
  return text
    .replace(/<[^>]*>/g, '')           // strip HTML
    .replace(/[^\w\s\-.,!?₦@#()/]/g, '') // safe chars only
    .trim()
    .slice(0, maxLength);
}

export function isValidPhone(phone: string): boolean {
  return /^\d{10,15}$/.test(phone.replace(/\D/g, ''));
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function hoursAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));
}