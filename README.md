# Postgres Simple Migrations

A tiny migration tool for Node.js/Bun build for [`postgres.js`](https://github.com/porsager/postgres).

It keeps things simple: no CLI magic, just a typed class you can use in your own scripts.

## Features

- **Zero Heavy Dependencies**: Only depends on `postgres` (peer dependency).
- **Advisory Locks**: Prevents race conditions when multiple instances try to migrate simultaneously.
- **Atomic**: Migrations are applied inside transactions. If a migration fails, the DB state rolls back.
- **File-based Scanning**: Automatically loads and sorts migrations from a directory.

## Installation

### npm
```bash
npm install @philosophocat/postgres-migrations
```

### bun
```bash
bun add @philosophocat/postgres-migrations
```

## Usage

Create a file in your migrations folder (e.g., migrations/001_init.ts). The file name determines the execution order.

```typescript
  // migrations/001_init.ts
import { Sql } from 'postgres';

// The export name must be 'migration' or 'default'
export const migration = {
    name: 'users', // optional
    async up(sql: Sql) {
        await sql`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `;
    },
    async down(sql: Sql) {
        await sql`DROP TABLE users`;
    },
};
```

And run your migrations

```typescript
import { resolve } from 'node:path';
import postgres from 'postgres';
import { Migrator } from '@philosophocat/postgres-migrations';

// 1. Setup postgres client
const sql = postgres(process.env.DATABASE_URL!);

// 2. Initialize Migrator
const migrator = new Migrator({
    sql,
    // schema, default 'public'
    // tableName, default 'migrations'
    // lockId, optional advisory lock id
});

const run = async () => {
    try {
        // 3. Scan directory for .ts/.js files
        await migrator.scan(resolve(__dirname, '../migrations'));
        await migrator.up();
    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        await sql.end();
    }
};

run();
```
