import { v4 as uuid } from 'uuid';

interface Ticket {
  userId: string;
  tokenHash: string;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();
const TICKET_TTL_MS = 30_000;

export function issueWsTicket(userId: string, tokenHash: string): string {
  const id = uuid();
  tickets.set(id, { userId, tokenHash, expiresAt: Date.now() + TICKET_TTL_MS });
  return id;
}

export function redeemWsTicket(id: string): { userId: string; tokenHash: string } | null {
  const ticket = tickets.get(id);
  if (!ticket) return null;
  tickets.delete(id); // one-time use
  if (Date.now() > ticket.expiresAt) return null;
  return { userId: ticket.userId, tokenHash: ticket.tokenHash };
}

// Clean up expired tickets
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (now > ticket.expiresAt) tickets.delete(id);
  }
}, 60_000);
