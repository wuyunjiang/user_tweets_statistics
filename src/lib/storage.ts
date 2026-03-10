import type { PersistedSnapshot, QueryFormState } from '../types';

const QUERY_KEY = 'twitter-stats-query';
const SNAPSHOT_KEY = 'twitter-stats-snapshot';

export function loadStoredQuery(): QueryFormState | null {
  const raw = localStorage.getItem(QUERY_KEY);
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as Partial<QueryFormState> & {
    token?: string;
    range?: [string, string] | null;
  };
  if ('startDate' in parsed) {
    return parsed as QueryFormState;
  }
  return {
    username: parsed.username ?? '',
    startDate: parsed.range?.[0] ?? null,
  };
}

export function saveStoredQuery(query: QueryFormState) {
  localStorage.setItem(QUERY_KEY, JSON.stringify(query));
}

export function loadSnapshot(): PersistedSnapshot | null {
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as {
    query?: Partial<QueryFormState> & { token?: string; range?: [string, string] | null };
    records?: PersistedSnapshot['records'];
    savedAt?: string;
  };
  if (!parsed.query || !parsed.records || !parsed.savedAt) {
    return null;
  }
  return {
    query: 'startDate' in parsed.query
      ? (parsed.query as QueryFormState)
      : {
          username: parsed.query.username ?? '',
          startDate: parsed.query.range?.[0] ?? null,
        },
    records: parsed.records,
    savedAt: parsed.savedAt,
  };
}

export function saveSnapshot(snapshot: PersistedSnapshot) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}
