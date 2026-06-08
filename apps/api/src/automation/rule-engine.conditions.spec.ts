import { RuleEngineService } from './rule-engine.service';

/**
 * Unit tests for the automation/routing rule CONDITION evaluation — the pure
 * matching logic (operators + and/or nesting) that decides whether a rule
 * fires. No DB: the engine's injected deps are unused by these code paths, so
 * we pass empty mocks and reach the private evaluators by cast.
 */

function engine(): RuleEngineService {
  // Condition evaluation never touches prisma/sla/tickets deps.
  return new RuleEngineService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

type Ctx = Record<string, unknown>;

function ctx(overrides: Ctx = {}): Ctx {
  return {
    id: 't1',
    subject: 'Printer is broken',
    description: 'Cannot print',
    priority: 'SEV2',
    status: 'OPEN',
    assignedTeamId: null,
    assigneeId: null,
    categoryId: null,
    requesterId: 'r1',
    ...overrides,
  };
}

// Thin typed accessors for the private methods under test.
const evalSingle = (
  e: RuleEngineService,
  field: string,
  operator: string,
  value: unknown,
  c: Ctx,
): boolean =>
  (
    e as unknown as {
      evaluateSingle: (f: string, o: string, v: unknown, c: Ctx) => boolean;
    }
  ).evaluateSingle(field, operator, value, c);

const evalConds = (
  e: RuleEngineService,
  conditions: unknown[],
  c: Ctx,
): boolean =>
  (
    e as unknown as {
      evaluateConditions: (conds: unknown[], c: Ctx) => boolean;
    }
  ).evaluateConditions(conditions, c);

describe('RuleEngineService — condition evaluation', () => {
  let e: RuleEngineService;
  beforeEach(() => {
    e = engine();
  });

  describe('operators (case-insensitive)', () => {
    it('contains', () => {
      expect(evalSingle(e, 'subject', 'contains', 'printer', ctx())).toBe(true);
      expect(evalSingle(e, 'subject', 'contains', 'scanner', ctx())).toBe(false);
    });

    it('equals / notEquals', () => {
      expect(evalSingle(e, 'priority', 'equals', 'sev2', ctx())).toBe(true);
      expect(evalSingle(e, 'priority', 'equals', 'SEV1', ctx())).toBe(false);
      expect(evalSingle(e, 'priority', 'notEquals', 'SEV1', ctx())).toBe(true);
      expect(evalSingle(e, 'priority', 'notEquals', 'sev2', ctx())).toBe(false);
    });

    it('in / notIn against an array', () => {
      expect(evalSingle(e, 'priority', 'in', ['SEV1', 'SEV2'], ctx())).toBe(
        true,
      );
      expect(evalSingle(e, 'priority', 'in', ['SEV1', 'SEV3'], ctx())).toBe(
        false,
      );
      expect(evalSingle(e, 'priority', 'notIn', ['SEV1', 'SEV3'], ctx())).toBe(
        true,
      );
      expect(evalSingle(e, 'priority', 'notIn', ['SEV1', 'SEV2'], ctx())).toBe(
        false,
      );
    });

    it('isEmpty / isNotEmpty', () => {
      expect(
        evalSingle(e, 'assigneeId', 'isEmpty', null, ctx({ assigneeId: null })),
      ).toBe(true);
      expect(
        evalSingle(
          e,
          'assigneeId',
          'isNotEmpty',
          null,
          ctx({ assigneeId: null }),
        ),
      ).toBe(false);
      expect(
        evalSingle(
          e,
          'assigneeId',
          'isNotEmpty',
          null,
          ctx({ assigneeId: 'a1' }),
        ),
      ).toBe(true);
    });

    it('treats whitespace-only values as empty', () => {
      expect(
        evalSingle(e, 'subject', 'isEmpty', null, ctx({ subject: '   ' })),
      ).toBe(true);
    });

    it('unknown operator -> false', () => {
      expect(evalSingle(e, 'priority', 'startsWith', 'SEV', ctx())).toBe(false);
    });

    it('normalizes non-string field values (numbers/booleans)', () => {
      expect(
        evalSingle(e, 'viewCount', 'equals', 5, ctx({ viewCount: 5 })),
      ).toBe(true);
      expect(
        evalSingle(e, 'isInternal', 'equals', true, ctx({ isInternal: true })),
      ).toBe(true);
    });
  });

  describe('evaluateConditions (top-level AND of nodes)', () => {
    it('requires every top-level node to match', () => {
      const conds = [
        { field: 'priority', operator: 'equals', value: 'SEV2' },
        { field: 'subject', operator: 'contains', value: 'printer' },
      ];
      expect(evalConds(e, conds, ctx())).toBe(true);
      expect(evalConds(e, conds, ctx({ subject: 'laptop slow' }))).toBe(false);
    });

    it('AND node: all children must match', () => {
      const conds = [
        {
          and: [
            { field: 'priority', operator: 'equals', value: 'SEV2' },
            { field: 'status', operator: 'equals', value: 'OPEN' },
          ],
        },
      ];
      expect(evalConds(e, conds, ctx())).toBe(true);
      expect(evalConds(e, conds, ctx({ status: 'RESOLVED' }))).toBe(false);
    });

    it('OR node: any child matches', () => {
      const conds = [
        {
          or: [
            { field: 'priority', operator: 'equals', value: 'SEV1' },
            { field: 'priority', operator: 'equals', value: 'SEV2' },
          ],
        },
      ];
      expect(evalConds(e, conds, ctx())).toBe(true);
      expect(evalConds(e, conds, ctx({ priority: 'SEV4' }))).toBe(false);
    });

    it('supports nested and/or', () => {
      const conds = [
        {
          and: [
            {
              or: [
                { field: 'priority', operator: 'equals', value: 'SEV1' },
                { field: 'priority', operator: 'equals', value: 'SEV2' },
              ],
            },
            { field: 'subject', operator: 'contains', value: 'printer' },
          ],
        },
      ];
      expect(evalConds(e, conds, ctx())).toBe(true);
      expect(evalConds(e, conds, ctx({ priority: 'SEV4' }))).toBe(false);
      expect(evalConds(e, conds, ctx({ subject: 'laptop' }))).toBe(false);
    });

    it('a malformed node (no field/and/or) evaluates to false', () => {
      expect(evalConds(e, [{ nonsense: true } as unknown], ctx())).toBe(false);
    });
  });
});
