/**
 * Offline AI routing accuracy benchmark.
 *
 * Runs a labeled corpus through the real pipeline via `debugPipeline`, which is
 * a pure dry run — it persists no tickets and writes no observability rows.
 * Scores with the SAME function the production endpoint uses
 * (`scoreAccuracy`), so the two can never disagree.
 *
 * This SPENDS MONEY: roughly three model calls per case. It never runs
 * automatically — set AI_BENCHMARK_ENABLED=true to allow it.
 *
 * Usage:
 *   AI_BENCHMARK_ENABLED=true npx ts-node -r tsconfig-paths/register \
 *     scripts/run-accuracy-benchmark.ts [path/to/corpus.json]
 *
 * Exits non-zero when accuracy is below AI_ACCURACY_MIN (default 0.85), so it
 * can gate a deploy.
 */

import { NestFactory } from '@nestjs/core';
import fs from 'fs';
import path from 'path';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/ai/ai.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  scoreAccuracy,
  type ScoredCorrection,
  type ScoredDecision,
} from '../src/reports/ai-accuracy.scoring';
import type { AuthUser } from '../src/auth/current-user.decorator';

interface CorpusCase {
  id: string;
  inputText: string;
  expectedDepartment: string;
  expectedPriority?: string;
  source: string;
}

interface Corpus {
  version: number;
  cases: CorpusCase[];
}

const DEFAULT_CORPUS = path.join(
  __dirname,
  '..',
  'test',
  'ai',
  'corpus',
  'starter-corpus.json',
);

function readCorpus(file: string): Corpus {
  if (!fs.existsSync(file)) {
    throw new Error(`Corpus not found: ${file}`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Corpus;
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error(`Corpus has no cases: ${file}`);
  }
  return parsed;
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  if (process.env.AI_BENCHMARK_ENABLED !== 'true') {
    console.error(
      'Refusing to run: this benchmark makes real Azure OpenAI calls (about 3 per case).\n' +
        'Set AI_BENCHMARK_ENABLED=true to allow it.',
    );
    process.exit(2);
  }

  const corpusPath = process.argv[2] ?? DEFAULT_CORPUS;
  const corpus = readCorpus(corpusPath);
  console.log(`Corpus: ${corpusPath} (${corpus.cases.length} cases)`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const aiService = app.get(AiService);
    const prisma = app.get(PrismaService);

    // Predictions come back as team ids; the corpus is written in slugs so it
    // survives a reseed. Build the mapping once.
    const teams = await prisma.team.findMany({ select: { id: true, slug: true } });
    const slugById = new Map(teams.map((team) => [team.id, team.slug]));

    // The pipeline needs an acting user for tool context. This user reads
    // nothing it can leak into the result; the run persists nothing.
    const benchmarkUser: AuthUser = {
      id: 'benchmark-runner',
      email: 'benchmark@local',
      displayName: 'Accuracy Benchmark',
      role: 'OWNER',
      teamId: null,
      primaryTeamId: null,
      memberTeamIds: [],
    } as AuthUser;

    const decisions: ScoredDecision[] = [];
    const corrections: ScoredCorrection[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    for (const [index, testCase] of corpus.cases.entries()) {
      process.stdout.write(
        `[${index + 1}/${corpus.cases.length}] ${testCase.id} ... `,
      );
      try {
        const result = await aiService.debugPipeline(
          { text: testCase.inputText, channel: 'PORTAL' },
          benchmarkUser,
        );
        const ticket = result.ticket as { assignedTeamId?: string | null } | undefined;
        const predictedId = ticket?.assignedTeamId ?? null;
        const predictedSlug = predictedId
          ? (slugById.get(predictedId) ?? predictedId)
          : null;
        const classificationStep = result.steps.find((step) => step.step === 2);
        const parsed = classificationStep?.parsed as
          | { department?: { confidence?: number } }
          | undefined;
        const confidence = parsed?.department?.confidence ?? 0;

        // A pipeline error is NOT a triage. Triage means the gate deliberately
        // declined to predict; an error means the run failed. Counting the
        // second as the first hides breakage behind a healthy-looking report.
        if (result.finalStatus === 'error') {
          failures.push({
            id: testCase.id,
            reason: result.errorMessage ?? 'pipeline returned error',
          });
          console.log(`PIPELINE ERROR: ${result.errorMessage ?? 'unknown'}`);
          continue;
        }

        decisions.push({
          ticketId: testCase.id,
          predictedTeamId: predictedSlug,
          confidence,
          // A clarification is the gate declining to predict, not a wrong answer.
          accepted: result.finalStatus === 'created',
        });
        if (predictedSlug !== testCase.expectedDepartment) {
          corrections.push({
            ticketId: testCase.id,
            toValue: testCase.expectedDepartment,
          });
        }
        const toolsUsed = classificationStep?.toolsCalled ?? [];
        console.log(
          `${predictedSlug ?? 'none'} (expected ${testCase.expectedDepartment})${
            predictedSlug === testCase.expectedDepartment ? '' : '  <- MISS'
          }  [tools: ${toolsUsed.length ? toolsUsed.join(', ') : 'NONE'}]`,
        );
        if (process.env.AI_BENCHMARK_VERBOSE === 'true') {
          console.log(`    raw id: ${predictedId ?? 'null'}`);
          console.log(`    status: ${classificationStep?.status ?? 'n/a'}`);
          if (classificationStep?.error) {
            console.log(`    error : ${classificationStep.error}`);
          }
          console.log(
            `    step2 : ${String(classificationStep?.rawOutput ?? '').slice(0, 400)}`,
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        failures.push({ id: testCase.id, reason });
        console.log(`ERROR: ${reason}`);
      }
    }

    const minAccuracy = Number(process.env.AI_ACCURACY_MIN ?? '0.85');
    const report = scoreAccuracy(decisions, corrections, minAccuracy);

    console.log('\n=== AI Routing Accuracy ===');
    console.log(`Cases run        : ${decisions.length}`);
    console.log(`Auto-routed      : ${report.acceptedDecisions}`);
    console.log(`Sent to triage   : ${report.triagedDecisions}`);
    console.log(`Misrouted        : ${report.correctedDecisions}`);
    console.log(`Accuracy         : ${percent(report.accuracy)}`);
    console.log(`Threshold        : ${percent(report.threshold)}`);
    console.log(`Result           : ${report.thresholdMet ? 'PASS' : 'FAIL'}`);

    console.log('\nBy department (precision / recall / F1):');
    for (const [department, score] of Object.entries(report.byDepartment)) {
      console.log(
        `  ${department.padEnd(20)} ${percent(score.precision).padStart(6)} / ` +
          `${percent(score.recall).padStart(6)} / ${percent(score.f1).padStart(6)}`,
      );
    }

    console.log('\nConfusion matrix (predicted -> actual):');
    for (const [predicted, actuals] of Object.entries(report.confusionMatrix)) {
      for (const [actual, count] of Object.entries(actuals)) {
        const marker = predicted === actual ? ' ' : '*';
        console.log(`  ${marker} ${predicted} -> ${actual}: ${count}`);
      }
    }

    if (failures.length > 0) {
      console.log(`\n${failures.length} case(s) errored:`);
      for (const failure of failures) {
        console.log(`  ${failure.id}: ${failure.reason}`);
      }
    }

    if (corpus.cases.some((testCase) => testCase.source === 'synthetic')) {
      console.log(
        '\nNOTE: this corpus contains synthetic cases. It guards against regressions;\n' +
          'it does not prove accuracy on real employee requests. Replace with\n' +
          'champion-authored cases and corrections harvested from CorrectionLog.',
      );
    }

    process.exitCode = report.thresholdMet && failures.length === 0 ? 0 : 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
