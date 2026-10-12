import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const ROOT = join(import.meta.dirname, '..', '..')
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres'

export interface TestUser {
  uid: string
  phone: string
  personId: string
}

export interface TestDb {
  /** Runs SQL as a signed-in user, with RLS applied. */
  as<T extends pg.QueryResultRow = pg.QueryResultRow>(
    user: { uid: string; phone?: string } | null,
    sql: string,
    params?: unknown[],
  ): Promise<T[]>
  /** Runs SQL as the database owner (bypasses RLS). */
  admin<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>
  /** Creates an auth user and claims a profile for them. */
  signUp(name: string, phone: string): Promise<TestUser>
  close(): Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const dbName = `hisaab_test_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`create database ${dbName}`)

  const url = new URL(ADMIN_URL)
  url.pathname = `/${dbName}`
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  await client.query(readFileSync(join(ROOT, 'tests/db/auth_stub.sql'), 'utf8'))
  const migrations = join(ROOT, 'supabase/migrations')
  for (const file of readdirSync(migrations).sort()) {
    await client.query(readFileSync(join(migrations, file), 'utf8'))
  }

  const db: TestDb = {
    async as(user, sql, params = []) {
      await client.query('begin')
      try {
        await client.query('set local role authenticated')
        const claims = user ? { sub: user.uid, phone: user.phone ?? '', role: 'authenticated' } : {}
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
        const result = await client.query(sql, params)
        await client.query('commit')
        return result.rows
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    },
    async admin(sql, params = []) {
      return (await client.query(sql, params)).rows
    },
    async signUp(name, phone) {
      const uid = randomUUID()
      await client.query('insert into auth.users (id) values ($1)', [uid])
      const [row] = await db.as<{ id: string }>({ uid }, 'select public.claim_profile($1, $2) as id', [
        name,
        phone,
      ])
      return { uid, phone, personId: row.id }
    },
    async close() {
      await client.end()
      await admin.query(`drop database ${dbName} with (force)`)
      await admin.end()
    },
  }
  return db
}
