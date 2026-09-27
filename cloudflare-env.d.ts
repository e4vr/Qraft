declare namespace Cloudflare {
  interface Env {
    BACKUP_SIGNING_KEY?: string;
    IMAGEKIT_PRIVATE_KEY?: string;
    R2_PUBLIC_URL?: string;
    R2_BILLING_CYCLE_DAY?: string;
    R2_STORAGE_CAP_BYTES?: string;
    R2_CLASS_A_MONTHLY_CAP?: string;
    R2_CLASS_B_MONTHLY_CAP?: string;
    API_RATE_LIMITER?: RateLimit;
    MUTATION_RATE_LIMITER?: RateLimit;
    AUTH_RATE_LIMITER?: RateLimit;
    QUESTION_BACKUP_RETENTION_DAYS?: string;
    QUESTION_BACKUP_MAX_BYTES?: string;
    BUILD_VERSION?: string;
    BUILD_TIMESTAMP?: string;
    BUILD_SERVICE_WORKER?: string;
    BUILD_SCHEMA?: string;
    BUILD_PACKAGE_VERSION?: string;
  }
}
