-- CreateEnum
CREATE TYPE "SlaNotifyRole" AS ENUM ('AGENT', 'LEAD', 'MANAGER', 'OWNER');

-- CreateTable
CREATE TABLE "SlaPolicyConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT true,
    "escalationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "escalationAfterPercent" INTEGER NOT NULL DEFAULT 80,
    "breachNotifyRoles" "SlaNotifyRole"[] NOT NULL DEFAULT ARRAY['AGENT', 'LEAD']::"SlaNotifyRole"[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaPolicyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicyConfigTarget" (
    "id" TEXT NOT NULL,
    "policyConfigId" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "firstResponseHours" INTEGER NOT NULL,
    "resolutionHours" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaPolicyConfigTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicyAssignment" (
    "id" TEXT NOT NULL,
    "policyConfigId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaPolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaBusinessHoursSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "schedule" JSONB NOT NULL,
    "holidays" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaBusinessHoursSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlaPolicyConfig_isDefault_idx" ON "SlaPolicyConfig"("isDefault");

-- CreateIndex
CREATE INDEX "SlaPolicyConfig_enabled_idx" ON "SlaPolicyConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicyConfigTarget_policyConfigId_priority_key" ON "SlaPolicyConfigTarget"("policyConfigId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicyAssignment_teamId_key" ON "SlaPolicyAssignment"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicyAssignment_policyConfigId_teamId_key" ON "SlaPolicyAssignment"("policyConfigId", "teamId");

-- AddForeignKey
ALTER TABLE "SlaPolicyConfig" ADD CONSTRAINT "SlaPolicyConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicyConfigTarget" ADD CONSTRAINT "SlaPolicyConfigTarget_policyConfigId_fkey" FOREIGN KEY ("policyConfigId") REFERENCES "SlaPolicyConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicyAssignment" ADD CONSTRAINT "SlaPolicyAssignment_policyConfigId_fkey" FOREIGN KEY ("policyConfigId") REFERENCES "SlaPolicyConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicyAssignment" ADD CONSTRAINT "SlaPolicyAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
