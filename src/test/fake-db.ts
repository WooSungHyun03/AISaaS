/**
 * A tiny in-memory stand-in for the supabase-js query builder, just enough for the channel-collection tests:
 * select / insert / upsert / update / delete with `eq`, `neq`, `is`, `lt`, `or` (ignored: every row counts as matching),
 * `in`, `order`, `limit`, `maybeSingle`, `single` and a trailing `.select()` after an update (rows that really matched).
 * Filters are applied for real, so a "compare-and-set" claim only succeeds for a row that still has the old value.
 */
type Row = Record<string, unknown>;
type Filter = { column: string; kind: "eq" | "neq" | "is" | "lt" | "in"; value: unknown };

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Every write, in order: handy for "was this ever inserted/updated" assertions. */
  writes: Array<{ table: string; op: "insert" | "upsert" | "update" | "delete"; payload?: unknown; filters?: Filter[] }>;
  client: { from: (name: string) => unknown };
}

export function makeFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const writes: FakeDb["writes"] = [];
  let counter = 0;

  const matches = (row: Row, filters: Filter[]) =>
    filters.every((filter) => {
      const value = row[filter.column] ?? null;
      if (filter.kind === "is") return value === filter.value;
      if (filter.kind === "in") return (filter.value as unknown[]).includes(value);
      if (filter.kind === "neq") return value !== filter.value;
      if (filter.kind === "lt") return value !== null && String(value) < String(filter.value);
      return value === filter.value;
    });

  function builder(table: string) {
    tables[table] ??= [];
    const state: { op: "select" | "insert" | "upsert" | "update" | "delete"; payload?: unknown; filters: Filter[]; returning: boolean; limit?: number; options?: { onConflict?: string } } = { op: "select", filters: [], returning: false };

    const exec = (): { data: unknown; error: null } => {
      const rows = tables[table];
      switch (state.op) {
        case "select": {
          const found = rows.filter((row) => matches(row, state.filters)).slice(0, state.limit ?? Infinity);
          return { data: found.map((row) => ({ ...row })), error: null };
        }
        case "insert":
        case "upsert": {
          const incoming = (Array.isArray(state.payload) ? state.payload : [state.payload]) as Row[];
          const created: Row[] = [];
          for (const item of incoming) {
            const keys = state.op === "upsert" && state.options?.onConflict ? state.options.onConflict.split(",") : [];
            const existing = keys.length > 0 ? rows.find((row) => keys.every((key) => row[key] === item[key])) : undefined;
            if (existing) Object.assign(existing, item);
            else {
              const row = { id: `${table}-${++counter}`, ...item };
              rows.push(row);
              created.push(row);
            }
          }
          return { data: created.map((row) => ({ ...row })), error: null };
        }
        case "update": {
          const hit = rows.filter((row) => matches(row, state.filters));
          for (const row of hit) Object.assign(row, state.payload);
          return { data: state.returning ? hit.map((row) => ({ ...row })) : null, error: null };
        }
        case "delete": {
          const keep = rows.filter((row) => !matches(row, state.filters));
          const removed = rows.length - keep.length;
          tables[table] = keep;
          return { data: null, error: null, ...({ count: removed } as object) };
        }
      }
    };

    const api: Record<string, unknown> = {
      select: () => {
        if (state.op === "select") state.op = "select";
        else state.returning = true;
        return api;
      },
      insert: (payload: unknown) => {
        state.op = "insert";
        state.payload = payload;
        writes.push({ table, op: "insert", payload });
        return api;
      },
      upsert: (payload: unknown, options?: { onConflict?: string }) => {
        state.op = "upsert";
        state.payload = payload;
        state.options = options;
        writes.push({ table, op: "upsert", payload });
        return api;
      },
      update: (payload: unknown) => {
        state.op = "update";
        state.payload = payload;
        return api;
      },
      delete: () => {
        state.op = "delete";
        return api;
      },
      eq: (column: string, value: unknown) => (state.filters.push({ column, kind: "eq", value }), api),
      neq: (column: string, value: unknown) => (state.filters.push({ column, kind: "neq", value }), api),
      is: (column: string, value: unknown) => (state.filters.push({ column, kind: "is", value }), api),
      in: (column: string, value: unknown[]) => (state.filters.push({ column, kind: "in", value }), api),
      lt: (column: string, value: unknown) => (state.filters.push({ column, kind: "lt", value }), api),
      or: () => api,
      order: () => api,
      limit: (count: number) => ((state.limit = count), api),
      range: () => api,
      maybeSingle: () => {
        const result = exec();
        return Promise.resolve({ data: (result.data as Row[])[0] ?? null, error: null });
      },
      single: () => {
        const result = exec();
        return Promise.resolve({ data: (result.data as Row[])[0] ?? null, error: null });
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (state.op === "update" || state.op === "delete") writes.push({ table, op: state.op, payload: state.payload, filters: [...state.filters] });
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    return api;
  }

  return { tables, writes, client: { from: (name: string) => builder(name) } };
}
