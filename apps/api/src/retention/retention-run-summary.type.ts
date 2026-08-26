/** What one retention tick did (or would have done, when dryRun). */
export type RetentionRunSummary = {
  ranAt: string;
  dryRun: boolean;
  softDeletedTicketsPurged: number;
  closedTicketsPurged: number;
  kbArticlesPurged: number;
  adminAuditEventsPurged: number;
  outboxRowsPurged: number;
  attachmentFilesDeleted: number;
  attachmentFileErrors: number;
};
