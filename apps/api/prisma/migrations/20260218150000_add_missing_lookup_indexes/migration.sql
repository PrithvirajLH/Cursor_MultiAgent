CREATE INDEX IF NOT EXISTS "RoutingRule_teamId_idx"
ON "RoutingRule"("teamId");

CREATE INDEX IF NOT EXISTS "TeamMember_userId_idx"
ON "TeamMember"("userId");

CREATE INDEX IF NOT EXISTS "Category_parentId_idx"
ON "Category"("parentId");
