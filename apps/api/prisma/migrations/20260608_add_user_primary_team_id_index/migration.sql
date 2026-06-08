-- Index User.primaryTeamId. TEAM_ADMIN user listings scope the User query by
-- primaryTeamId (users.service.ts getUserListScope); without this index that
-- filter is a sequential scan of the User table.
CREATE INDEX "User_primaryTeamId_idx" ON "User"("primaryTeamId");
