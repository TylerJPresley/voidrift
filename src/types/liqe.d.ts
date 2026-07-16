declare module "liqe" {
  export function parse(query: string): unknown;
  export function filter(ast: unknown, items: unknown[]): unknown[];
}
