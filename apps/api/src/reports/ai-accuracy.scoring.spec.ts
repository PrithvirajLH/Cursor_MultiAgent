import {
  scoreAccuracy,
  type ScoredCorrection,
  type ScoredDecision,
} from './ai-accuracy.scoring';

function decision(
  ticketId: string,
  predictedTeamId: string,
  confidence = 0.9,
  accepted = true,
): ScoredDecision {
  return { ticketId, predictedTeamId, confidence, accepted };
}

function correction(ticketId: string, toValue: string): ScoredCorrection {
  return { ticketId, toValue };
}

describe('scoreAccuracy', () => {
  describe('with no data', () => {
    it('reports null rates rather than zero', () => {
      const report = scoreAccuracy([], [], 0.85);
      // "no data" and "0% accurate" must not look identical on a dashboard.
      expect(report.accuracy).toBeNull();
      expect(report.thresholdMet).toBe(false);
      expect(report.totalDecisions).toBe(0);
      expect(report.byDepartment).toEqual({});
    });

    it('never emits NaN', () => {
      const report = scoreAccuracy([decision('t1', 'it')], [], 0.85);
      const values = Object.values(report.byDepartment).flatMap((score) => [
        score.precision,
        score.recall,
        score.f1,
      ]);
      for (const value of values) {
        expect(Number.isNaN(value as number)).toBe(false);
      }
    });
  });

  describe('accuracy', () => {
    it('counts an uncorrected decision as correct', () => {
      const report = scoreAccuracy([decision('t1', 'it')], [], 0.85);
      expect(report.accuracy).toBe(1);
      expect(report.correctedDecisions).toBe(0);
      expect(report.thresholdMet).toBe(true);
    });

    it('counts a corrected decision as wrong', () => {
      const report = scoreAccuracy(
        [decision('t1', 'it')],
        [correction('t1', 'hr')],
        0.85,
      );
      expect(report.accuracy).toBe(0);
      expect(report.correctedDecisions).toBe(1);
      expect(report.thresholdMet).toBe(false);
    });

    it('computes 88% from 12 corrections in 100 decisions', () => {
      const decisions = Array.from({ length: 100 }, (_, i) =>
        decision(`t${i}`, 'it'),
      );
      const corrections = Array.from({ length: 12 }, (_, i) =>
        correction(`t${i}`, 'hr'),
      );
      const report = scoreAccuracy(decisions, corrections, 0.85);
      expect(report.accuracy).toBeCloseTo(0.88, 5);
      expect(report.thresholdMet).toBe(true);
    });

    it('passes at exactly the threshold', () => {
      const decisions = Array.from({ length: 20 }, (_, i) =>
        decision(`t${i}`, 'it'),
      );
      const corrections = Array.from({ length: 3 }, (_, i) =>
        correction(`t${i}`, 'hr'),
      );
      const report = scoreAccuracy(decisions, corrections, 0.85);
      expect(report.accuracy).toBeCloseTo(0.85, 5);
      expect(report.thresholdMet).toBe(true);
    });

    it('ignores a correction that did not change the team', () => {
      const report = scoreAccuracy(
        [decision('t1', 'it')],
        [correction('t1', 'it')],
        0.85,
      );
      expect(report.accuracy).toBe(1);
      expect(report.correctedDecisions).toBe(0);
    });

    it('takes the most recent correction when a ticket was moved twice', () => {
      const report = scoreAccuracy(
        [decision('t1', 'it')],
        [correction('t1', 'hr'), correction('t1', 'it')],
        0.85,
      );
      // Moved away and then back: the AI was right after all.
      expect(report.accuracy).toBe(1);
    });
  });

  describe('triaged decisions', () => {
    it('excludes them from accuracy — the gate declined to predict', () => {
      const report = scoreAccuracy(
        [decision('t1', 'it'), decision('t2', 'hr', 0.4, false)],
        [],
        0.85,
      );
      expect(report.totalDecisions).toBe(2);
      expect(report.acceptedDecisions).toBe(1);
      expect(report.triagedDecisions).toBe(1);
      expect(report.accuracy).toBe(1);
    });
  });

  describe('per-department precision, recall and F1', () => {
    // it: 2 kept, 1 moved to hr  -> TP 2, FP 1
    // hr: 1 kept, gains 1 from it -> TP 1, FN 0, and it's FN comes to hr
    it('matches a hand-computed fixture', () => {
      const decisions = [
        decision('t1', 'it'),
        decision('t2', 'it'),
        decision('t3', 'it'),
        decision('t4', 'hr'),
      ];
      const corrections = [correction('t3', 'hr')];
      const report = scoreAccuracy(decisions, corrections, 0.85);

      expect(report.byDepartment.it).toEqual({
        truePositives: 2,
        falsePositives: 1,
        falseNegatives: 0,
        precision: 2 / 3,
        recall: 1,
        f1: (2 * (2 / 3) * 1) / (2 / 3 + 1),
      });
      expect(report.byDepartment.hr).toEqual({
        truePositives: 1,
        falsePositives: 0,
        falseNegatives: 1,
        precision: 1,
        recall: 0.5,
        f1: (2 * 1 * 0.5) / 1.5,
      });
      expect(report.accuracy).toBeCloseTo(0.75, 5);
    });

    it('reports null precision for a department that was never predicted', () => {
      const report = scoreAccuracy(
        [decision('t1', 'it')],
        [correction('t1', 'finance')],
        0.85,
      );
      // finance was only ever a correction target, never a prediction.
      expect(report.byDepartment.finance.truePositives).toBe(0);
      expect(report.byDepartment.finance.falseNegatives).toBe(1);
      expect(report.byDepartment.finance.precision).toBeNull();
      expect(report.byDepartment.finance.recall).toBe(0);
      expect(report.byDepartment.finance.f1).toBeNull();
    });
  });

  describe('confusion matrix', () => {
    it('maps predicted to actual', () => {
      const report = scoreAccuracy(
        [decision('t1', 'it'), decision('t2', 'it'), decision('t3', 'hr')],
        [correction('t2', 'hr')],
        0.85,
      );
      expect(report.confusionMatrix).toEqual({
        it: { it: 1, hr: 1 },
        hr: { hr: 1 },
      });
    });
  });

  describe('lowest confidence', () => {
    it('surfaces the weakest accepted decisions, ascending', () => {
      const report = scoreAccuracy(
        [
          decision('t1', 'it', 0.95),
          decision('t2', 'it', 0.62),
          decision('t3', 'it', 0.78),
        ],
        [],
        0.85,
        2,
      );
      expect(report.lowestConfidence.map((row) => row.ticketId)).toEqual([
        't2',
        't3',
      ]);
    });

    it('carries ids only, so the report is safe to screenshot', () => {
      const report = scoreAccuracy([decision('t1', 'it', 0.5)], [], 0.85);
      expect(Object.keys(report.lowestConfidence[0]).sort()).toEqual([
        'confidence',
        'predictedTeamId',
        'ticketId',
      ]);
    });
  });

  it('always states the ground-truth caveat', () => {
    const report = scoreAccuracy([], [], 0.85);
    expect(report.caveat).toMatch(/upper bound/i);
  });
});
