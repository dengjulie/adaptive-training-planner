import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env.ts'
import * as schema from './schema.ts'

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL })

export const db = drizzle({ client: pool, schema, casing: 'snake_case' })

export type Db = typeof db
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
