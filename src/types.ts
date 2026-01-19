import type { Sql, TransactionSql } from 'postgres';

export interface Migration {
    name: string;
    up(sql: Sql | TransactionSql): Promise<void>;
    down(sql: Sql | TransactionSql): Promise<void>;
}

export interface MigratorOptions {
    sql: Sql;
    schema?: string;
    tableName?: string;
    lockId?: number;
    verbose?: boolean;
}

export interface MigrationRecord {
    id: number;
    name: string;
    run_on: Date;
}
