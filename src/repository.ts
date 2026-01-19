import type { Sql } from 'postgres';
import { MigratorOptions } from './types';

export class Repository {
    private readonly schema: string;
    private readonly tableName: string;
    private readonly sql: Sql;
    private readonly lockID: number;

    constructor({
        sql,
        schema = 'public',
        tableName = 'migrations',
        lockId = 2128506,
    }: MigratorOptions) {
        this.sql = sql;
        this.schema = schema;
        this.tableName = tableName;
        this.lockID = lockId;
    }

    async ensureTable() {
        await this.sql`CREATE SCHEMA IF NOT EXISTS ${this.sql(this.schema)}`;
        await this.sql`
            CREATE TABLE IF NOT EXISTS ${ this.sql(this.schema) }.${ this.sql(this.tableName) } (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `;
    };

    async tryLock(): Promise<boolean> {
        const [result] = await this.sql`
            SELECT pg_try_advisory_lock(${ this.lockID }) as locked
        `;
        return !!result?.locked;
    };

    async unlock(): Promise<void> {
        await this.sql`
            SELECT pg_advisory_unlock(${ this.lockID })
        `;
    };

    async listApplied(): Promise<Set<string>> {
        await this.ensureTable();

        const rows = await this.sql<{ name: string }[]>`
            SELECT name FROM ${ this.sql(this.schema) }.${ this.sql(this.tableName) }
        `;

        return new Set(rows.map(r => r.name));
    };

    async markApplied(
        name: string,
        trx?: Sql
    ) {
        const sql = trx || this.sql;
        await sql`
            INSERT INTO ${ this.sql(this.schema) }.${ this.sql(this.tableName) } (name) VALUES (${name})
        `;
    }

    async unmarkApplied(
        name: string,
        trx?: Sql
    ) {
        const sql = trx || this.sql;
        await sql`
            DELETE FROM ${ this.sql(this.schema) }.${ this.sql(this.tableName) } WHERE name = ${name}
        `;
    }
}