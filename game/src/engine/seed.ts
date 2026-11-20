// The Users rows of game/src/recordings/juiceshop.sqlite as typed data, so initialWorld() is synchronous.
// seed.test.ts checks this list against the real file.
import type { Account } from './state';

const row = (id: number, email: string, role: Account['role'], lockedAt?: number): Account =>
  lockedAt === undefined ? { id, email, role, createdBy: 'seed' } : { id, email, role, createdBy: 'seed', lockedAt };

export const SEED_ACCOUNTS: readonly Account[] = [
  row(1, 'admin@juice-sh.op', 'admin'),
  row(2, 'jim@juice-sh.op', 'customer'),
  row(3, 'bender@juice-sh.op', 'customer'),
  row(4, 'bjoern.kimminich@gmail.com', 'admin'),
  row(5, 'ciso@juice-sh.op', 'deluxe'),
  row(6, 'support@juice-sh.op', 'admin'),
  row(7, 'morty@juice-sh.op', 'customer'),
  row(8, 'mc.safesearch@juice-sh.op', 'customer'),
  row(9, 'J12934@juice-sh.op', 'admin'),
  row(10, 'wurstbrot@juice-sh.op', 'admin'),
  row(11, 'amy@juice-sh.op', 'customer'),
  row(12, 'bjoern@juice-sh.op', 'admin'),
  row(13, 'bjoern@owasp.org', 'deluxe'),
  row(14, 'chris.pike@juice-sh.op', 'customer', 0), // deletedAt is set in the baseline
  row(15, 'accountant@juice-sh.op', 'accounting'),
  row(16, 'uvogin@juice-sh.op', 'customer'),
  row(17, 'demo', 'customer'),
  row(18, 'john@juice-sh.op', 'customer'),
  row(19, 'emma@juice-sh.op', 'customer'),
  row(20, 'stan@juice-sh.op', 'deluxe'),
  row(21, 'ethereum@juice-sh.op', 'deluxe'),
  row(22, 'testing@juice-sh.op', 'admin'),
  row(23, 'cloud-admin@juice-sh.op', 'admin'),
  row(24, 'basil@juice-sh.op', 'customer'),
  row(25, 'passkey-user@juice-sh.op', 'customer'),
];

export const SEED_PRODUCT_COUNT = 56;
