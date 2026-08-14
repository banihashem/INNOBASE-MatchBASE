import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface TransactionClient extends Queryable {
  release(): void;
}

export interface ConnectionPool extends Queryable {
  connect(): Promise<TransactionClient>;
  end(): Promise<void>;
}

export function createPool(config: PoolConfig): ConnectionPool {
  return new Pool(config) as ConnectionPool;
}

export async function inTransaction<T>(
  pool: ConnectionPool,
  operation: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type { PoolClient, PoolConfig };
