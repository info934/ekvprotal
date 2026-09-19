export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  rows: Row[];
  total: number | null;
}

export type FilterOperator = "eq" | "neq" | "is" | "gte" | "lte" | "gt" | "lt" | "ilike" | "in";

export interface QueryFilter {
  column: string;
  operator: FilterOperator;
  value: string | number | boolean | null | readonly string[];
}

export interface QueryOptions {
  select: string;
  filters?: readonly QueryFilter[];
  or?: string;
  order?: string;
  limit?: number;
  offset?: number;
  count?: boolean;
}
