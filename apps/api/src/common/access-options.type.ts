/**
 * Options for the ticket access chokepoint. `includeDeleted` is honoured only
 * for OWNER; every other role always sees soft-deleted tickets filtered out.
 */
export type AccessOptions = { includeDeleted?: boolean };
