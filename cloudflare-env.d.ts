declare namespace Cloudflare {
  interface Env {
    REALTIME: DurableObjectNamespace<import('./workers/realtime').RealtimeChannel>;
    ROOT_ADMIN_EMAIL?: string;
    ROOT_ADMIN_SETUP_TOKEN?: string;
    IMAGEKIT_PRIVATE_KEY?: string;
  }
}
