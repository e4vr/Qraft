import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable(
  'profiles',
  {
    uid: text('uid').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    profileJson: text('profile_json').notNull(),
    totpSecret: text('totp_secret'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_profiles_email').on(table.email)],
);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => profiles.uid, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const appStates = sqliteTable('app_states', {
  userId: text('user_id')
    .primaryKey()
    .references(() => profiles.uid, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const universityClaims = sqliteTable(
  'university_claims',
  {
    universityId: text('university_id').primaryKey(),
    userId: text('user_id').notNull(),
    claimedAt: text('claimed_at').notNull(),
  },
  (table) => [uniqueIndex('idx_university_claims_user').on(table.userId)],
);

export const records = sqliteTable(
  'records',
  {
    type: text('type').notNull(),
    id: text('id').notNull(),
    qbankId: text('qbank_id'),
    ownerId: text('owner_id'),
    email: text('email'),
    payload: text('payload').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_records_type_id').on(table.type, table.id),
    index('idx_records_type_email').on(table.type, table.email),
  ],
);

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

export const subscriptionSettings = sqliteTable('subscription_settings', {
  id: integer('id').primaryKey(),
  price: integer('price').notNull(),
});

export const discountCodes = sqliteTable(
  'discount_codes',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    amount: integer('amount').notNull(),
    enabled: integer('enabled').notNull().default(1),
    startsAt: text('starts_at'),
    expiresAt: text('expires_at'),
    maxUses: integer('max_uses'),
    perUser: integer('per_user'),
    uses: integer('uses').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_discount_codes_code').on(table.code)],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => profiles.uid),
    status: text('status').notNull(),
    startsAt: text('starts_at'),
    expiresAt: text('expires_at'),
    method: text('method').notNull(),
    discountCode: text('discount_code'),
    paid: integer('paid').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_subscriptions_expiration').on(table.status, table.expiresAt),
  ],
);

export const subscriptionEvents = sqliteTable(
  'subscription_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    adminId: text('admin_id'),
    codeId: text('code_id'),
    code: text('code'),
    action: text('action').notNull(),
    original: integer('original').notNull(),
    discount: integer('discount').notNull(),
    final: integer('final').notNull(),
    status: text('status').notNull(),
    startsAt: text('starts_at'),
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
    detail: text('detail').notNull(),
  },
  (table) => [
    index('idx_subscription_events_code').on(table.codeId, table.createdAt),
    index('idx_subscription_events_user_code').on(
      table.userId,
      table.codeId,
      table.status,
    ),
  ],
);

export const testRegistry = sqliteTable(
  'test_registry',
  {
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid),
    testId: text('test_id').notNull(),
    questionCount: integer('question_count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.testId] })],
);

export const questionRegistry = sqliteTable(
  'question_registry',
  {
    id: text('id').primaryKey(),
    uuid: text('uuid').notNull(),
    questionId: text('question_id').notNull(),
    qbankId: text('qbank_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_question_registry_question_id').on(table.questionId),
    uniqueIndex('idx_question_registry_uuid').on(table.uuid),
  ],
);

export const retiredQuestions = sqliteTable(
  'retired_questions',
  {
    id: text('id').primaryKey(),
    uuid: text('uuid').notNull(),
    deletedAt: text('deleted_at').notNull(),
  },
  (table) => [uniqueIndex('idx_retired_questions_uuid').on(table.uuid)],
);

export const tickets = sqliteTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid),
    title: text('title').notNull(),
    status: text('status').notNull(),
    questionUuid: text('question_uuid').references(
      () => questionRegistry.uuid,
      { onDelete: 'set null' },
    ),
    questionLinked: integer('question_linked').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_tickets_status_updated').on(table.status, table.updatedAt),
    index('idx_tickets_user_updated').on(table.userId, table.updatedAt),
  ],
);

export const ticketMessages = sqliteTable(
  'ticket_messages',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid),
    body: text('body').notNull(),
    attachment: text('attachment'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_ticket_messages_ticket').on(table.ticketId, table.createdAt),
  ],
);

export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  result: text('result').notNull(),
});
