import { readdirSync } from 'node:fs';
import { join, parse } from 'node:path';
import { Repository } from './repository';
import { Migration, MigratorOptions } from './types';

export class Migrator {

    private migrations: Migration[] = [];

    private repo: Repository;

    constructor(
        private readonly options: MigratorOptions
    ) {
        this.repo = new Repository(options);
    }

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
                console.warn(`Skipping ${file}: no migration export found`);
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
            return console.log('Empty migrations list')
        }

        const locked = await this.repo.tryLock();
        if (!locked) {
            return console.log('Migrations are locked by another process');
        }

        try {
            const applied = await this.repo.listApplied();

            for (const m of this.migrations) {
                if (!applied.has(m.name)) {
                    console.log(`Applying: ${ m.name }`);

                    await this.options.sql.begin(async (trx) => {
                        await m.up(trx);
                        await this.repo.markApplied(m.name, trx);
                    });
                }
            }
        } catch (e) {
            console.error('Migration failed:', e);
            throw e;
        } finally {
            await this.repo.unlock();
        }
    };

    down = async (
        count = 1
    )  => {
        const locked = await this.repo.tryLock();
        if (!locked) {
            return console.log('Migrations locked');
        }

        try {
            const applied = await this.repo.listApplied();
            const toRollback = this.migrations
                .slice()
                .reverse()
                .filter(m => applied.has(m.name));

            let rolledBackCount = 0;
            for (const m of toRollback) {
                if (rolledBackCount >= count && count !== -1) {
                    break;
                }

                await this.options.sql.begin(async (trx) => {
                    await m.down(trx);
                    await this.repo.unmarkApplied(m.name, trx);
                });
                console.log(`Reverted: ${m.name}`);
                rolledBackCount++;
            }
        } finally {
            await this.repo.unlock();
        }
    }

    async close() {
        await this.options.sql.end();
    };
}
