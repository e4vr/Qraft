import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

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
  revision: integer('revision').notNull().default(0),
  lastOperationId: text('last_operation_id'),
});

export const stateSyncOperations = sqliteTable(
  'state_sync_operations',
  {
    userId: text('user_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
  },
  table => [
    primaryKey({ columns: [table.userId, table.operationId] }),
    index('idx_state_sync_operations_created').on(table.createdAt),
  ],
);

export const qbankClassificationRevisions = sqliteTable(
  'qbank_classification_revisions',
  {
    qbankId: text('qbank_id').primaryKey(),
    revision: integer('revision').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
);

export const classificationOperations = sqliteTable(
  'classification_operations',
  {
    operationId: text('operation_id').primaryKey(),
    userId: text('user_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
    qbankId: text('qbank_id').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
  },
  table => [index('idx_classification_operations_created').on(table.createdAt)],
);

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
    index('idx_records_type_owner_updated').on(table.type, table.ownerId, sql`${table.updatedAt} DESC`),
    index('idx_records_qbank_type').on(table.qbankId, table.type),
    index('idx_records_type_updated_at').on(table.type, sql`${table.updatedAt} DESC`),
    index('idx_records_pending_owner_updated').on(table.ownerId, sql`${table.updatedAt} DESC`).where(sql`${table.type}='questionProposals' AND json_extract(${table.payload},'$.status')='pending'`),
    index('idx_records_membership_user_role').on(sql`json_extract(${table.payload},'$.userId')`, sql`json_extract(${table.payload},'$.role')`, table.qbankId).where(sql`${table.type}='qbankMemberships'`),
  ],
);

export const questionIds = sqliteTable('question_ids', {
  questionId: text('question_id').primaryKey(),
  qbankId: text('qbank_id').notNull(),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const questionIdAllocator = sqliteTable('question_id_allocator', {
  scope: text('scope').primaryKey(),
  nextValue: integer('next_value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const questionIdFreePool = sqliteTable('question_id_free_pool', {
  numericId: integer('numeric_id').primaryKey(),
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
  provider: text('provider').notNull().default('imagekit'),
  storageKey: text('storage_key'),
  fileHash: text('file_hash'),
  originalName: text('original_name'),
  purpose: text('purpose').notNull().default('question'),
  status: text('status').notNull().default('ready'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
}, table => [
  index('idx_media_qbank_created').on(table.qbankId, table.createdAt),
  index('idx_media_owner_hash').on(table.ownerId, table.fileHash),
  index('idx_media_expiry').on(table.status, table.expiresAt),
]);

export const r2UsagePeriods = sqliteTable('r2_usage_periods', {
  periodStart: text('period_start').primaryKey(),
  classAOperations: integer('class_a_operations').notNull().default(0),
  classBOperations: integer('class_b_operations').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
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
    allowedPlans: text('allowed_plans').notNull().default('["full_monthly","full_quarterly"]'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_discount_codes_code').on(sql`${table.code} COLLATE NOCASE`)],
);

export const accountPlanOverrides = sqliteTable('account_plan_overrides', {
  userId: text('user_id').primaryKey().references(() => profiles.uid, { onDelete: 'cascade' }),
  plan: text('plan', { enum: ['free', 'full_monthly', 'full_quarterly'] }).notNull(),
  expiresAt: text('expires_at'),
  reason: text('reason').notNull().default(''),
  updatedBy: text('updated_by').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => profiles.uid),
    status: text('status').notNull(),
    plan: text('plan').notNull().default('full_monthly'),
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
    plan: text('plan').notNull().default('full_monthly'),
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
    startedAt: text('started_at'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.testId] }),
    index('idx_test_registry_user_started').on(table.userId, table.startedAt),
  ],
);

export const preformedTests = sqliteTable(
  'preformed_tests',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    ownerId: text('owner_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
    ownerName: text('owner_name').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    visibility: text('visibility', { enum: ['public', 'private'] }).notNull().default('private'),
    status: text('status', { enum: ['draft', 'published', 'paused', 'hidden'] }).notNull().default('draft'),
    version: integer('version').notNull().default(1),
    editRevision: integer('edit_revision').notNull().default(0),
    questionsJson: text('questions_json').notNull().default('[]'),
    settingsJson: text('settings_json').notNull().default('{}'),
    passcodeHash: text('passcode_hash'),
    passcodeSalt: text('passcode_salt'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [
    uniqueIndex('idx_preformed_tests_code').on(table.code),
    index('idx_preformed_tests_owner_updated').on(table.ownerId, table.updatedAt),
    index('idx_preformed_tests_public_updated').on(table.visibility, table.status, table.updatedAt),
  ],
);

export const preformedLeaderboard = sqliteTable(
  'preformed_leaderboard',
  {
    id: text('id').primaryKey(),
    testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    participantUserId: text('participant_user_id').references(() => profiles.uid, { onDelete: 'set null' }),
    participantKey: text('participant_key').notNull(),
    participantName: text('participant_name').notNull(),
    guest: integer('guest', { mode: 'boolean' }).notNull().default(false),
    score: integer('score').notNull(),
    questionCount: integer('question_count').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    submittedAt: text('submitted_at').notNull(),
  },
  table => [
    index('idx_preformed_leaderboard_rank').on(table.testId, table.version, sql`${table.score} DESC`, table.durationSeconds, table.submittedAt),
    index('idx_preformed_leaderboard_participant').on(table.testId, table.version, table.participantKey),
    index('idx_preformed_leaderboard_user').on(table.participantUserId),
  ],
);

export const preformedQuestionStats = sqliteTable(
  'preformed_question_stats',
  {
    testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    questionId: text('question_id').notNull(),
    submissions: integer('submissions').notNull().default(0),
    correct: integer('correct').notNull().default(0),
  },
  table => [primaryKey({ columns: [table.testId, table.version, table.questionId] })],
);

export const preformedParticipation = sqliteTable(
  'preformed_participation',
  {
    testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    userId: text('user_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  table => [primaryKey({ columns: [table.testId, table.version, table.userId] })],
);

export const preformedAttemptTokens = sqliteTable('preformed_attempt_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  userId: text('user_id'),
  issuedAt: text('issued_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  submittedAt: text('submitted_at'),
}, table => [index('idx_preformed_attempt_tokens_user').on(table.userId), index('idx_preformed_attempt_tokens_expiry').on(table.expiresAt)]);

export const preformedSubmissionReceipts = sqliteTable('preformed_submission_receipts', {
  submissionId: text('submission_id').primaryKey(),
  testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
  attemptTokenHash: text('attempt_token_hash'),
  userId: text('user_id').references(() => profiles.uid, { onDelete: 'cascade' }),
  leaderboard: integer('leaderboard', { mode: 'boolean' }).notNull().default(false),
  resultJson: text('result_json'),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('idx_preformed_submission_receipts_attempt_token').on(table.attemptTokenHash),
  index('idx_preformed_receipts_user').on(table.userId),
  index('idx_preformed_submission_receipts_created').on(table.createdAt),
]);

export const preformedParticipantQuestionStats = sqliteTable('preformed_participant_question_stats', {
  userId: text('user_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
  testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  questionId: text('question_id').notNull(),
  submissions: integer('submissions').notNull().default(0),
  correct: integer('correct').notNull().default(0),
}, table => [primaryKey({ columns: [table.userId, table.testId, table.version, table.questionId] })]);

export const preformedReports = sqliteTable(
  'preformed_reports',
  {
    id: text('id').primaryKey(),
    testId: text('test_id').notNull().references(() => preformedTests.id, { onDelete: 'cascade' }),
    reporterId: text('reporter_id').notNull().references(() => profiles.uid, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
  },
  table => [uniqueIndex('idx_preformed_reports_user_test').on(table.reporterId, table.testId), index('idx_preformed_reports_test').on(table.testId, table.createdAt)],
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

export const importedFiles = sqliteTable(
  'imported_files',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    fileHash: text('file_hash').notNull(),
    batchId: text('batch_id').notNull(),
    sourceFile: text('source_file').notNull(),
    successfulCount: integer('successful_count').notNull(),
    skippedCount: integer('skipped_count').notNull(),
    reportJson: text('report_json').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    dailyLimit: integer('daily_limit').notNull().default(1_000_000),
    pendingLimit: integer('pending_limit').notNull().default(1_000_000),
    runId: text('run_id'),
    questionLimit: integer('question_limit').notNull().default(1_000_000),
  },
  (table) => [
    uniqueIndex('idx_imported_files_batch').on(table.batchId),
    index('idx_imported_files_user_uploaded').on(table.userId, table.uploadedAt),
    index('idx_imported_files_user_run').on(table.userId, table.runId, table.uploadedAt),
  ],
);

export const jsonImportRuns = sqliteTable(
  'json_import_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    qbankId: text('qbank_id').notNull(),
    fileName: text('file_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    fileHash: text('file_hash').notNull(),
    sourceFile: text('source_file').notNull().default(''),
    status: text('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').notNull().default(1),
    completedChunks: integer('completed_chunks').notNull().default(0),
    totalCount: integer('total_count').notNull().default(0),
    successfulCount: integer('successful_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    skippedDuplicateCount: integer('skipped_duplicate_count')
      .notNull()
      .default(0),
    flaggedDuplicateCount: integer('flagged_duplicate_count')
      .notNull()
      .default(0),
    repaired: integer('repaired', { mode: 'boolean' }).notNull().default(false),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: text('started_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    deletedAt: text('deleted_at'),
    deletedBy: text('deleted_by'),
    legacy: integer('legacy', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('idx_json_import_runs_started').on(table.startedAt),
    index('idx_json_import_runs_status_started').on(
      table.status,
      table.startedAt,
    ),
    index('idx_json_import_runs_user_started').on(
      table.userId,
      table.startedAt,
    ),
    index('idx_json_import_runs_qbank_started').on(
      table.qbankId,
      table.startedAt,
    ),
    index('idx_json_import_runs_hash').on(table.fileHash, table.startedAt),
  ],
);

export const jsonImportAttempts = sqliteTable(
  'json_import_attempts',
  {
    requestId: text('request_id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => jsonImportRuns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull().default(0),
    chunkHash: text('chunk_hash').notNull(),
    status: text('status').notNull(),
    totalCount: integer('total_count').notNull().default(0),
    successfulCount: integer('successful_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    skippedDuplicateCount: integer('skipped_duplicate_count')
      .notNull()
      .default(0),
    flaggedDuplicateCount: integer('flagged_duplicate_count')
      .notNull()
      .default(0),
    reportJson: text('report_json').notNull().default('[]'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: text('started_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_json_import_attempts_run_chunk').on(
      table.runId,
      table.chunkIndex,
    ),
    index('idx_json_import_attempts_user_started').on(
      table.userId,
      table.startedAt,
    ),
  ],
);

export const planPrices = sqliteTable('plan_prices', {
  plan: text('plan').primaryKey(),
  priceSarPeriod: integer('price_sar_period').notNull(),
  updatedAt: text('updated_at').notNull(),
  priceHalalas: integer('price_halalas'),
  policyJson: text('policy_json'),
});

export const contributionAccounts = sqliteTable('contribution_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => profiles.uid, { onDelete: 'cascade' }),
  creditsBalance: integer('credits_balance').notNull().default(0),
  lifetimeScore: integer('lifetime_score').notNull().default(0),
  trustScore: integer('trust_score').notNull().default(100),
  updatedAt: text('updated_at').notNull(),
});

export const creditTransactions = sqliteTable(
  'credit_transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    lifetimeDelta: integer('lifetime_delta').notNull().default(0),
    type: text('type').notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    metadata: text('metadata').notNull().default('{}'),
  },
  (table) => [
    index('idx_credit_transactions_user_created').on(
      table.userId,
      sql`${table.createdAt} DESC`,
    ),
    uniqueIndex('idx_credit_transactions_reference').on(table.userId, table.type, table.referenceType, table.referenceId).where(sql`${table.referenceId} IS NOT NULL`),
  ],
);

export const rewardPasses = sqliteTable(
  'reward_passes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    duration: integer('duration').notNull(),
    durationUnit: text('duration_unit').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    activatedAt: text('activated_at'),
    expiresAt: text('expires_at'),
    source: text('source').notNull(),
    creditTransactionId: text('credit_transaction_id').unique().references(() => creditTransactions.id),
    durationDays: integer('duration_days'),
    metadata: text('metadata').notNull().default('{}'),
  },
  (table) => [
    index('idx_reward_passes_user_status').on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
    check('reward_passes_duration_days', sql`${table.durationDays} BETWEEN 1 AND 730`),
  ],
);

export const adminPlanEntitlements = sqliteTable(
  'admin_plan_entitlements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    plan: text('plan').notNull(),
    active: integer('active').notNull().default(1),
    reason: text('reason').notNull(),
    grantedBy: text('granted_by').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at'),
  },
  (table) => [
    index('idx_admin_plan_entitlements_user').on(
      table.userId,
      table.active,
      table.expiresAt,
    ),
  ],
);

export const jsonImportSuspensions = sqliteTable(
  'json_import_suspensions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    createdBy: text('created_by').notNull(),
    removedAt: text('removed_at'),
    removedBy: text('removed_by'),
  },
  (table) => [
    index('idx_json_import_suspensions_user').on(
      table.userId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export const duplicateAttempts = sqliteTable(
  'duplicate_attempts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    contentHash: text('content_hash').notNull(),
    referenceId: text('reference_id'),
    confirmed: integer('confirmed').notNull().default(0),
    createdAt: text('created_at').notNull(),
    metadata: text('metadata').notNull().default('{}'),
  },
  (table) => [
    index('idx_duplicate_attempts_user_created').on(
      table.userId,
      table.confirmed,
      table.createdAt,
    ),
  ],
);

export const duplicatePairDecisions = sqliteTable(
  'duplicate_pair_decisions',
  {
    id: text('id').primaryKey(),
    qbankId: text('qbank_id').notNull(),
    proposalId: text('proposal_id').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    candidateEntityType: text('candidate_entity_type').notNull(),
    candidateEntityId: text('candidate_entity_id').notNull(),
    candidateFingerprint: text('candidate_fingerprint').notNull(),
    classification: text('classification').notNull(),
    similarity: integer('similarity').notNull(),
    detectorVersion: text('detector_version').notNull(),
    decision: text('decision').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    reviewNote: text('review_note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_duplicate_pair_decisions_unchanged_pair').on(
      table.qbankId,
      table.proposalId,
      table.sourceFingerprint,
      table.candidateEntityType,
      table.candidateEntityId,
      table.candidateFingerprint,
    ),
    index('idx_duplicate_pair_decisions_proposal').on(table.proposalId, table.createdAt),
    index('idx_duplicate_pair_decisions_quality').on(table.qbankId, table.decision, table.createdAt),
  ],
);

export const duplicateScanRuns = sqliteTable(
  'duplicate_scan_runs',
  {
    id: text('id').primaryKey(),
    qbankId: text('qbank_id').notNull(),
    startedBy: text('started_by').notNull(),
    cursor: integer('cursor').notNull().default(0),
    scannedCount: integer('scanned_count').notNull().default(0),
    flaggedCount: integer('flagged_count').notNull().default(0),
    status: text('status').notNull(),
    detectorVersion: text('detector_version').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_duplicate_scan_runs_bank').on(table.qbankId, table.createdAt)],
);

export const duplicateResolutionClaims = sqliteTable(
  'duplicate_resolution_claims',
  {
    proposalId: text('proposal_id').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.sourceFingerprint] })],
);

export const contributionReviews = sqliteTable(
  'contribution_reviews',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposal_id').notNull(),
    authorId: text('author_id').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    decision: text('decision').notNull(),
    highRisk: integer('high_risk').notNull().default(0),
    createdAt: text('created_at').notNull(),
    metadata: text('metadata').notNull().default('{}'),
  },
  (table) => [
    uniqueIndex('idx_contribution_reviews_independent').on(table.proposalId, table.reviewerId),
    index('idx_contribution_reviews_created_reviewer').on(table.createdAt, table.reviewerId),
    index('idx_contribution_reviews_reviewer_created').on(
      table.reviewerId,
      table.createdAt,
    ),
    index('idx_contribution_reviews_author_created').on(table.authorId, sql`${table.createdAt} DESC`),
  ],
);

export const accountDeletions = sqliteTable('account_deletions', {
  id: text('id').primaryKey(),
  completedAt: text('completed_at').notNull(),
  snapshotValid: integer('snapshot_valid').notNull(),
}, table => [check('account_deletion_snapshot_valid', sql`${table.snapshotValid}=1`)]);

export const reviewCompletionClaims = sqliteTable('review_completion_claims', {
  proposalId: text('proposal_id').primaryKey(),
  reviewerId: text('reviewer_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const importDefaults = sqliteTable('import_defaults', {
  id: integer('id').primaryKey(),
  questionsPerImport: integer('questions_per_import'),
  importsPerDay: integer('imports_per_day'),
}, table => [
  check('import_defaults_singleton', sql`${table.id}=1`),
  check('import_defaults_questions', sql`${table.questionsPerImport} BETWEEN 1 AND 5000`),
  check('import_defaults_daily', sql`${table.importsPerDay} BETWEEN 1 AND 100`),
]);

export const importPolicies = sqliteTable('import_policies', {
  userId: text('user_id').primaryKey().references(() => profiles.uid, { onDelete: 'cascade' }),
  questionsPerImport: integer('questions_per_import').notNull(),
  importsPerDay: integer('imports_per_day').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('import_policies_questions', sql`${table.questionsPerImport} BETWEEN 1 AND 5000`),
  check('import_policies_daily', sql`${table.importsPerDay} BETWEEN 1 AND 100`),
]);

export const siteOperations = sqliteTable('site_operations', {
  id: integer('id').primaryKey(),
  maintenance: integer('maintenance').notNull().default(0),
  message: text('message').notNull().default('Qraft is undergoing scheduled maintenance. Please check back shortly.'),
  endsAt: text('ends_at'),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by'),
}, table => [check('site_operations_singleton', sql`${table.id}=1`), check('site_operations_maintenance', sql`${table.maintenance} IN (0,1)`)]);

export const monitoringIdentities = sqliteTable('monitoring_identities', {
  telemetryId: text('telemetry_id').primaryKey(),
  userId: text('user_id').notNull().unique().references(() => profiles.uid, { onDelete: 'cascade' }),
});

export const monitoringSnapshots = sqliteTable('monitoring_snapshots', {
  period: integer('period').primaryKey(),
  payload: text('payload'),
  refreshedAt: text('refreshed_at'),
  refreshAfter: text('refresh_after').notNull().default(''),
  source: text('source').notNull().default('unavailable'),
}, table => [check('monitoring_snapshots_period', sql`${table.period} IN (1,7,30)`)]);

export const monitoringQueryBudget = sqliteTable('monitoring_query_budget', {
  day: text('day').primaryKey(),
  used: integer('used').notNull().default(0),
}, table => [check('monitoring_query_budget_used', sql`${table.used} BETWEEN 0 AND 60`)]);

export const collaborationWriteGuards = sqliteTable('collaboration_write_guards', {
  id: text('id').primaryKey(),
  valid: integer('valid').notNull(),
}, table => [check('collaboration_snapshot_matches', sql`${table.valid}=1`)]);
