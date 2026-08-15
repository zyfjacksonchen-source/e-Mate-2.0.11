const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const principalPattern = /^[^\p{Cc}]{1,128}$/u;
const states = ['ACTIVE', 'ARCHIVED', 'DELETED'] as const;

export type SessionSummaryState = (typeof states)[number];

export type SessionSummary = {
  schemaVersion: 1;
  sessionId: string;
  ownerId: string;
  title: string;
  summary: string;
  projectId?: string;
  tags: string[];
  state: SessionSummaryState;
  updatedAt: string;
  sourceCursor: number;
};

export type SessionSummaryWrite = {
  schemaVersion: 1;
  title: string;
  summary: string;
  projectId?: string;
  tags: string[];
  state: SessionSummaryState;
  updatedAt: string;
  expectedSourceCursor: number | null;
};

export type SessionSummaryDraft = Omit<SessionSummaryWrite, 'expectedSourceCursor'>;

export type SessionSummarySearchIntent = {
  query: string;
  projectId?: string;
  includeArchived: boolean;
  limit: number;
};

export type SessionSummarySearchResult = {
  schemaVersion: 1;
  sessions: SessionSummary[];
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const actual = Object.keys(input).toSorted().join('|');
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in input)) || Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error(`Invalid fields: ${actual}`);
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function principal(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !principalPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || value.trim() !== value || (!allowEmpty && !value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function timestamp(value: unknown): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (typeof value !== 'string' || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('Invalid summary timestamp');
  }
  return value;
}

function cursor(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error('Invalid summary cursor');
  }
  return Number(value);
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error('Invalid summary tags');
  }
  const parsed = value.map((tag) => text(tag, 'summary tag', 48));
  if (new Set(parsed).size !== parsed.length) {
    throw new Error('Duplicate summary tags');
  }
  return parsed;
}

function state(value: unknown): SessionSummaryState {
  if (!states.includes(value as SessionSummaryState)) {
    throw new Error('Invalid summary state');
  }
  return value as SessionSummaryState;
}

export function parseSessionSummaryDraft(value: unknown): SessionSummaryDraft {
  const input = record(value, 'summary write');
  exact(input, ['schemaVersion', 'title', 'summary', 'tags', 'state', 'updatedAt'], ['projectId']);
  if (input.schemaVersion !== 1) throw new Error('Unsupported summary write');
  const parsedState = state(input.state);
  const parsed = {
    schemaVersion: 1 as const,
    title: text(input.title, 'summary title', 160, parsedState === 'DELETED'),
    summary: text(input.summary, 'session summary', 2_000, parsedState === 'DELETED'),
    ...(input.projectId === undefined ? {} : { projectId: identifier(input.projectId, 'project id') }),
    tags: tags(input.tags),
    state: parsedState,
    updatedAt: timestamp(input.updatedAt),
  };
  if (parsedState === 'DELETED' && (parsed.title || parsed.summary || parsed.tags.length > 0)) {
    throw new Error('Deleted summary retained content');
  }
  return parsed;
}

export function parseSessionSummaryWrite(value: unknown): SessionSummaryWrite {
  const input = record(value, 'summary write');
  exact(
    input,
    ['schemaVersion', 'title', 'summary', 'tags', 'state', 'updatedAt', 'expectedSourceCursor'],
    ['projectId']
  );
  const { expectedSourceCursor, ...draft } = input;
  return {
    ...parseSessionSummaryDraft(draft),
    expectedSourceCursor: cursor(expectedSourceCursor, true),
  };
}

export function parseSessionSummary(value: unknown): SessionSummary {
  const input = record(value, 'session summary');
  exact(
    input,
    ['schemaVersion', 'sessionId', 'ownerId', 'title', 'summary', 'tags', 'state', 'updatedAt', 'sourceCursor'],
    ['projectId']
  );
  const write = parseSessionSummaryWrite({
    schemaVersion: input.schemaVersion,
    title: input.title,
    summary: input.summary,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    tags: input.tags,
    state: input.state,
    updatedAt: input.updatedAt,
    expectedSourceCursor: input.sourceCursor,
  });
  return {
    schemaVersion: 1,
    sessionId: identifier(input.sessionId, 'session id'),
    ownerId: principal(input.ownerId, 'owner id'),
    title: write.title,
    summary: write.summary,
    ...(write.projectId ? { projectId: write.projectId } : {}),
    tags: write.tags,
    state: write.state,
    updatedAt: write.updatedAt,
    sourceCursor: write.expectedSourceCursor as number,
  };
}

export function parseSessionSummarySearchResult(value: unknown): SessionSummarySearchResult {
  const input = record(value, 'summary search result');
  exact(input, ['schemaVersion', 'sessions']);
  if (input.schemaVersion !== 1 || !Array.isArray(input.sessions) || input.sessions.length > 50) {
    throw new Error('Invalid summary search result');
  }
  const sessions = input.sessions.map(parseSessionSummary);
  if (new Set(sessions.map(({ sessionId }) => sessionId)).size !== sessions.length) {
    throw new Error('Duplicate summary result');
  }
  return { schemaVersion: 1, sessions };
}

export function parseSessionSummaryIdentifier(value: unknown): string {
  return identifier(value, 'session id');
}

export function parseSessionSummarySearchIntent(value: unknown): SessionSummarySearchIntent {
  const input = record(value, 'summary search intent');
  exact(input, ['query', 'includeArchived', 'limit'], ['projectId']);
  if (
    typeof input.query !== 'string' ||
    input.query.trim() !== input.query ||
    input.query.length > 200 ||
    typeof input.includeArchived !== 'boolean' ||
    !Number.isSafeInteger(input.limit) ||
    Number(input.limit) < 1 ||
    Number(input.limit) > 50
  ) {
    throw new Error('Invalid summary search intent');
  }
  return {
    query: input.query,
    ...(input.projectId === undefined ? {} : { projectId: identifier(input.projectId, 'project id') }),
    includeArchived: input.includeArchived,
    limit: Number(input.limit),
  };
}
