export type VisualFilterType = "all" | "song" | "live";

export interface VisualFilter {
  year: string;
  type: VisualFilterType;
}

const VALID_TYPES = new Set<VisualFilterType>(["all", "song", "live"]);

function validYear(value: string | null | undefined): string {
  return value && /^\d{4}$/.test(value) ? value : "";
}

function validType(value: string | null | undefined): VisualFilterType {
  return VALID_TYPES.has(value as VisualFilterType) ? (value as VisualFilterType) : "all";
}

export function parseFilterQuery(query: string): VisualFilter {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  return {
    year: validYear(params.get("year")),
    type: validType(params.get("type")),
  };
}

export function serializeFilterQuery(filter: Partial<VisualFilter>): string {
  const params = new URLSearchParams();
  const type = validType(filter.type);
  const year = validYear(filter.year);
  if (type !== "all") params.set("type", type);
  if (year) params.set("year", year);
  const query = params.toString();
  return query ? `?${query}` : "";
}
