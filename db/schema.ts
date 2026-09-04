import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('profiles', {
  uid: text('uid').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  profileJson: text('profile_json').notNull(),
  totpSecret: text('totp_secret'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('idx_profiles_email').on(table.email)]);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const appStates = sqliteTable('app_states', {
  userId: text('user_id').primaryKey().references(() => profiles.uid, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const universityClaims = sqliteTable('university_claims', {
  universityId: text('university_id').primaryKey(),
  userId: text('user_id').notNull(),
  claimedAt: text('claimed_at').notNull(),
}, (table) => [uniqueIndex('idx_university_claims_user').on(table.userId)]);

export const records = sqliteTable('records', {
  type: text('type').notNull(),
  id: text('id').notNull(),
  qbankId: text('qbank_id'),
  ownerId: text('owner_id'),
  email: text('email'),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_records_type_id').on(table.type, table.id),
  index('idx_records_type_email').on(table.type, table.email),
]);

export const questionIds = sqliteTable('question_ids', {
  questionId: text('question_id').primaryKey(),
  qbankId: text('qbank_id').notNull(),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const counters = sqliteTable('counters', {
  id: text('id').primaryKey(),
  value: integer('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const media = sqliteTable('media', {
  key: text('key').primaryKey(),
  qbankId: text('qbank_id').notNull(),
  ownerId: text('owner_id').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
});
