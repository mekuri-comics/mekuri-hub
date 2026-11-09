/**
 * mekuri 沙盒提供的標準全域物件（plugin-api.d.ts「沙盒限制」）的型別。
 * QuickJS 沙盒沒有 DOM、fetch、Node.js API；只有這裡列出的物件，加上 ECMAScript 內建物件。
 * 在插件程式碼最上方加上：/// <reference types="@mekuri/plugin-sdk/sandbox-globals" />
 */
export {};

declare global {
  interface Console {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
  }
  /** 導向 mekuri.log */
  const console: Console;

  /** 最長 10 秒 */
  function setTimeout(handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]): number;
  function clearTimeout(id: number | undefined): void;

  function atob(data: string): string;
  function btoa(data: string): string;

  class TextEncoder {
    readonly encoding: 'utf-8';
    encode(input?: string): Uint8Array;
  }
  class TextDecoder {
    constructor(label?: 'utf-8' | 'utf8');
    readonly encoding: 'utf-8';
    decode(input?: Uint8Array | ArrayBuffer): string;
  }

  class URLSearchParams implements Iterable<[string, string]> {
    constructor(init?: string | URLSearchParams | Record<string, string> | Iterable<[string, string]>);
    readonly size: number;
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    forEach(cb: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: unknown): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    entries(): IterableIterator<[string, string]>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    toString(): string;
  }

  class URL {
    constructor(url: string | URL, base?: string | URL);
    static canParse(url: string | URL, base?: string | URL): boolean;
    href: string;
    readonly origin: string;
    protocol: string;
    username: string;
    password: string;
    host: string;
    hostname: string;
    port: string;
    pathname: string;
    search: string;
    hash: string;
    readonly searchParams: URLSearchParams;
    toString(): string;
    toJSON(): string;
  }
}
