-- Persist Microsoft Graph profile payload for signed-in users.
ALTER TABLE "User"
ADD COLUMN "graphProfile" JSONB;
