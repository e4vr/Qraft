declare module 'sql.js/dist/sql-wasm-browser.js' {
  interface QueryResult {
    columns: string[];
    values: Array<Array<string | number | Uint8Array | null>>;
  }

  interface Database {
    exec(sql: string): QueryResult[];
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export default function initSqlJs(configuration?: {
    locateFile?: (filename: string) => string;
  }): Promise<SqlJsStatic>;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
