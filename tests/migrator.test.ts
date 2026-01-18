import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import postgres from 'postgres';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Migrator } from '../src';

const sql = postgres({
    host: 'localhost',
    port: 5433,
    user: 'test',
    password: 'test',
    database: 'test_migrations',
    max: 1
});

const MIGRATIONS_DIR = join(__dirname, '__temp_migrations__');

describe('Migrator Integration Tests', () => {
    beforeAll(async () => {
        try { rmSync(MIGRATIONS_DIR, { recursive: true, force: true }); } catch {}
        mkdirSync(MIGRATIONS_DIR);
    });

    afterAll(async () => {
        try { rmSync(MIGRATIONS_DIR, { recursive: true, force: true }); } catch {}
        await sql.end();
    });

    beforeEach(async () => {
        await sql`DROP SCHEMA IF EXISTS public CASCADE`;
        await sql`CREATE SCHEMA public`;
        await sql`DROP TABLE IF EXISTS migrations`;
        try { rmSync(MIGRATIONS_DIR, { recursive: true, force: true }); } catch {}
        mkdirSync(MIGRATIONS_DIR);
    });

    it('should scan and apply migrations successfully', async () => {
        const migrationCode = `
            export const migration = {
                name: '001_init',
                up: async (sql) => {
                    await sql\`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)\`;
                },
                down: async (sql) => {
                    await sql\`DROP TABLE users\`;
                }
            };
        `;

        writeFileSync(join(MIGRATIONS_DIR, '001_create_users.ts'), migrationCode);

        const migrator = new Migrator({ sql });
        await migrator.scan(MIGRATIONS_DIR);
        await migrator.up();

        const usersTable = await sql`
            SELECT to_regclass('public.users') as reg
        `;
        expect(usersTable[0].reg).not.toBeNull();

        const applied = await sql`SELECT * FROM migrations`;
        expect(applied.length).toBe(1);
        expect(applied[0].name).toBe('001_init');
    });

    it('should rollback migrations', async () => {
        // Создаем миграцию
        const migrationCode = `
            export const migration = {
                up: async (sql) => sql\`CREATE TABLE test (id int)\`,
                down: async (sql) => sql\`DROP TABLE test\`
            };
        `;
        writeFileSync(join(MIGRATIONS_DIR, '001_test.ts'), migrationCode);

        const migrator = new Migrator({ sql });
        await migrator.scan(MIGRATIONS_DIR);

        await migrator.up();
        const checkUp = await sql`SELECT to_regclass('public.test') as reg`;
        expect(checkUp[0].reg).not.toBeNull();

        await migrator.down();
        const checkDown = await sql`SELECT to_regclass('public.test') as reg`;
        expect(checkDown[0].reg).toBeNull(); // Таблицы быть не должно

        const applied = await sql`SELECT * FROM migrations`;
        expect(applied.length).toBe(0);
    });

    it('should handle failed transaction and rollback partial changes', async () => {
        const migrationCode = `
            export const migration = {
                up: async (sql) => {
                    await sql\`CREATE TABLE partial_success (id int)\`;
                    await sql\`SELECT * FROM non_existent_table\`; 
                },
                down: async (sql) => {}
            };
        `;
        writeFileSync(join(MIGRATIONS_DIR, '001_fail.ts'), migrationCode);

        const migrator = new Migrator({ sql });
        await migrator.scan(MIGRATIONS_DIR);
        await expect(migrator.up()).rejects.toThrow();
        const checkTable = await sql`SELECT to_regclass('public.partial_success') as reg`;
        expect(checkTable[0].reg).toBeNull();

        const applied = await sql`SELECT * FROM migrations`;
        expect(applied.length).toBe(0);
    });
});