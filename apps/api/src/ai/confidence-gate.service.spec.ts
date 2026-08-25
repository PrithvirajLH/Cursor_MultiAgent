import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ConfidenceGateService } from './confidence-gate.service';
import type { ClassificationResult } from './types/pipeline.types';

type MockPrisma = {
  team: { findFirst: jest.Mock };
};

function classification(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    department: { id: 'team-it', name: 'IT', confidence: 0.9 },
    category: null,
    subcategory: null,
    suggestedPriority: 'SEV3',
    tags: [],
    isMultiDepartment: false,
    alternativeDepartments: [],
    reasoning: 'test fixture',
    ...overrides,
  };
}

describe('ConfidenceGateService', () => {
  let service: ConfidenceGateService;
  let prisma: MockPrisma;
  let env: Record<string, string | undefined>;

  beforeEach(() => {
    env = {};
    prisma = { team: { findFirst: jest.fn() } };
    service = new ConfidenceGateService(
      prisma as unknown as PrismaService,
      {
        get: jest.fn((key: string) => env[key]),
      } as unknown as ConfigService,
    );
  });

  function team(overrides: Partial<{ isSensitive: boolean; confidenceThreshold: number | null }> = {}) {
    prisma.team.findFirst.mockResolvedValue({
      isSensitive: false,
      confidenceThreshold: null,
      ...overrides,
    });
  }

  describe('threshold is configuration, not prompt prose', () => {
    it('passes at exactly the threshold', async () => {
      team();
      const result = await service.evaluate(
        classification({ department: { id: 't', name: 'IT', confidence: 0.75 } }),
      );
      expect(result.passed).toBe(true);
      expect(result.thresholdUsed).toBe(0.75);
      expect(result.reason).toBe('passed');
    });

    it('fails just below the threshold', async () => {
      team();
      const result = await service.evaluate(
        classification({ department: { id: 't', name: 'IT', confidence: 0.749 } }),
      );
      expect(result.passed).toBe(false);
      expect(result.reason).toBe('below_threshold');
    });

    it('honours AI_CONFIDENCE_THRESHOLD from the environment', async () => {
      env.AI_CONFIDENCE_THRESHOLD = '0.95';
      team();
      const result = await service.evaluate(
        classification({ department: { id: 't', name: 'IT', confidence: 0.9 } }),
      );
      expect(result.passed).toBe(false);
      expect(result.thresholdUsed).toBe(0.95);
    });

    it('applies the higher bar to a sensitive department', async () => {
      team({ isSensitive: true });
      const result = await service.evaluate(
        classification({ department: { id: 'don', name: 'DON', confidence: 0.8 } }),
      );
      expect(result.passed).toBe(false);
      expect(result.thresholdUsed).toBe(0.85);
    });

    it('lets a department override the default with its own threshold', async () => {
      team({ isSensitive: true, confidenceThreshold: 0.6 });
      const result = await service.evaluate(
        classification({ department: { id: 'don', name: 'DON', confidence: 0.7 } }),
      );
      expect(result.passed).toBe(true);
      expect(result.thresholdUsed).toBe(0.6);
    });

    it('falls back to the default when the env value is not a valid 0-1 number', async () => {
      env.AI_CONFIDENCE_THRESHOLD = 'not-a-number';
      team();
      const result = await service.evaluate(classification());
      expect(result.thresholdUsed).toBe(0.75);
    });
  });

  describe('scoring', () => {
    it('uses department confidence alone when there is no category', async () => {
      team();
      const result = await service.evaluate(
        classification({ department: { id: 't', name: 'IT', confidence: 0.8 } }),
      );
      expect(result.overallConfidence).toBeCloseTo(0.8, 5);
    });

    it('ignores a low-confidence category so the department can triage it', async () => {
      team();
      const result = await service.evaluate(
        classification({
          department: { id: 't', name: 'IT', confidence: 0.9 },
          category: { id: 'c', name: 'Vague', confidence: 0.2 },
        }),
      );
      expect(result.overallConfidence).toBeCloseTo(0.9, 5);
      expect(result.passed).toBe(true);
    });

    it('blends department and category when the category is trusted', async () => {
      team();
      const result = await service.evaluate(
        classification({
          department: { id: 't', name: 'IT', confidence: 0.9 },
          category: { id: 'c', name: 'Access', confidence: 0.6 },
        }),
      );
      // (0.9*0.6 + 0.6*0.3) / 0.9 = 0.8
      expect(result.overallConfidence).toBeCloseTo(0.8, 5);
    });

    it('clamps out-of-range confidences rather than trusting the model', async () => {
      team();
      const result = await service.evaluate(
        classification({ department: { id: 't', name: 'IT', confidence: 42 } }),
      );
      expect(result.overallConfidence).toBe(1);
    });
  });

  describe('fails closed', () => {
    it('always routes a multi-department request to triage', async () => {
      team();
      const result = await service.evaluate(
        classification({
          department: { id: 't', name: 'IT', confidence: 1 },
          isMultiDepartment: true,
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.reason).toBe('multi_department');
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('routes to triage when the classified department is not an active team', async () => {
      prisma.team.findFirst.mockResolvedValue(null);
      const result = await service.evaluate(
        classification({ department: { id: 'ghost', name: 'Ghost', confidence: 1 } }),
      );
      expect(result.passed).toBe(false);
      expect(result.reason).toBe('unknown_department');
    });
  });
});
