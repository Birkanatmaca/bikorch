declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  export interface Database {
    run(sql: string, params?: unknown[]): void
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>
    prepare(sql: string): Statement
    getRowsModified(): number
    export(): Uint8Array
    close(): void
  }

  export interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    get(): unknown[]
    getAsObject(): Record<string, SqlValue>
    getColumnNames(): string[]
    free(): boolean
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>
}
