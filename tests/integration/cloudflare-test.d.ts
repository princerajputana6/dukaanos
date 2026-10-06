declare module "cloudflare:test" {
  export interface D1Migration {
    name: string;
    queries: string[];
  }
  export function applyD1Migrations(db: D1Database, migrations: D1Migration[], migrationsTableName?: string): Promise<void>;
}
