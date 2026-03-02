import { SetMetadata } from '@nestjs/common';

/** Metadata key for route-specific throttle policy (RL-01). Resolved at runtime via RouteThrottlerGuard + ConfigService. */
export const THROTTLE_POLICY_KEY = 'throttlePolicy';

export type ThrottlePolicyName = 'webhook' | 'highWrite';

/** Marks a route as using webhook or highWrite throttle limits (read from ConfigService at request time). */
export const ThrottlePolicy = (policy: ThrottlePolicyName) =>
  SetMetadata(THROTTLE_POLICY_KEY, policy);
