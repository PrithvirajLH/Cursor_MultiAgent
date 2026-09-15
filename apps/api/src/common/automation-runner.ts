import type { AutomationTrigger } from './automation-trigger.type';

/**
 * The one automation capability `common/` needs, expressed where `common/` can
 * own it (card 1.103).
 *
 * ⚠️ THIS IS THE DEPENDENCY INVERSION THAT BREAKS THE CIRCULAR IMPORT.
 * `AutomationQueueService` lives in `common/` and needed exactly one method
 * from `RuleEngineService`. Importing it meant `CommonModule` imported
 * `AutomationModule`, which imports `NotificationsModule`, which imports
 * `CommonModule` — and `common` is `@Global`, so that loop sat under the whole
 * application. It was survivable only while the import statements in
 * `app.module.ts` happened to be ordered so the cycle resolved in a workable
 * sequence; adding three modules near the top of that file in card 2.6 stopped
 * the app booting entirely.
 *
 * An abstract class rather than an interface because Nest needs a runtime token
 * to inject against. `AutomationModule` binds it to `RuleEngineService` with
 * `useExisting`, so there is one instance and no behaviour changes.
 *
 * ⚠️ This file must stay a LEAF — it may import types from `common/` and
 * nothing else. The moment it imports a feature module the cycle is back.
 */
export abstract class AutomationRunner {
  /** Run every rule that matches this trigger for one ticket. */
  abstract runForTicket(
    ticketId: string,
    trigger: AutomationTrigger,
  ): Promise<{ executed: number; errors: string[] }>;
}
