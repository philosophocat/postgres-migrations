import { readdirSync } from 'node:fs';
import { join, parse } from 'node:path';
import type { Sql } from 'postgres';
import { Repository } from './repository';
import { Migration, MigratorOptions } from './types';

export class Migrator {

    private migrations: Migration[] = [];

    constructor(
        private readonly options: MigratorOptions
    ) {};

    private log = (
        message: string,
        level: 'info' | 'warn' = 'info'
    ) => {
        if (this.options.verbose || level === 'warn') {
            console.log(message);
        }
    };

    public scan = async (
        dir: string
    ) => {
        const files = readdirSync(dir)
            .filter(f => f.endsWith('.js') || f.endsWith('.ts'))
            .sort();

        for (const file of files) {
            const filePath = join(dir, file);
            const name = parse(file).name;
            const module = await import(filePath);
            const m = module.migration || module.default;

            if (!m) {
                this.log(`Skipping ${file}: no migration export found`, 'warn');
                continue;
            }

            if (this.migrations.find(migration => migration.name === name)) {
                throw new Error(`Duplicated migration name: ${name}`);
            }

            this.migrations.push({
                up: m.up,
                down: m.down,
                name: m.name || name,
            });
        }
    }

    up = async () => {
        if (this.migrations.length === 0) {
            return this.log('Empty migrations list');
        }

        const connection = await this.options.sql.reserve();
        try {
            await this.upLocked(connection);
        } finally {
            connection.release();
        }
    };

    private upLocked = async (
        connection: Sql
    ) => {
        const
            repo = new Repository({ ...this.options, sql: connection }),
            locked = await repo.tryLock();

        if (!locked) {
            return this.log('Migrations are locked by another process');
        }

        try {
            const applied = await repo.listApplied();

            for (const m of this.migrations) {
                if (applied.has(m.name)) continue;
                await this.applyMigration(m, repo, connection);
                this.log(`Applied: ${m.name}`);
            }
        } finally {
            await repo.unlock();
        }
    }

    private applyMigration = async (
        m: Migration,
        repo: Repository,
        connection: Sql
    )=>  {
        await connection`BEGIN`;
        try {
            await m.up(connection);
            await repo.markApplied(m.name, connection);
            await connection`COMMIT`;
        } catch (err) {
            await connection`ROLLBACK`;
            throw err;
        }
    }

    down = async (
        count = 1
    ) => {
        const connection = await this.options.sql.reserve();
        try {
            await this.downLocked(connection, count);
        } finally {
            connection.release();
        }
    }

    private downLocked = async (
        connection: Sql,
        count: number
    ) => {
        const
            repo = new Repository({ ...this.options, sql: connection }),
            locked = await repo.tryLock();

        if (!locked) {
            return this.log('Migrations locked');
        }

        try {
            const
                applied = await repo.listApplied(),
                toRollback = this.migrations
                    .slice()
                    .reverse()
                    .filter(m => applied.has(m.name));

            if (toRollback.length === 0) {
                return this.log('Nothing to rollback');
            }

            let rolledBackCount = 0;
            for (const m of toRollback) {
                if (count > 0 && rolledBackCount >= count) break;

                await this.revertMigration(m, repo, connection);
                this.log(`Reverted: ${m.name}`);

                rolledBackCount++;
            }
        } finally {
            await repo.unlock();
        }
    }

    private revertMigration = async(
        m: Migration,
        repo: Repository,
        connection: Sql
    ) => {
        await connection`BEGIN`;
        try {
            await m.down(connection);
            await repo.unmarkApplied(m.name, connection);
            await connection`COMMIT`;
        } catch (err) {
            await connection`ROLLBACK`;
            throw err;
        }
    }
}
