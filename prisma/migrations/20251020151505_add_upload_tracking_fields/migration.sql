-- CreateEnum
CREATE TYPE "public"."UploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "public"."File" ADD COLUMN     "cleanupAt" TIMESTAMP(3),
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "isOrphaned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "schoolDevelopementProgramId" TEXT,
ADD COLUMN     "uploadError" TEXT,
ADD COLUMN     "uploadExpiresAt" TIMESTAMP(3),
ADD COLUMN     "uploadProgress" INTEGER,
ADD COLUMN     "uploadRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uploadSessionId" TEXT,
ADD COLUMN     "uploadStatus" "public"."UploadStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "uploadUrl" TEXT;

-- CreateTable
CREATE TABLE "public"."SchoolDevelopementProgram" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "numberOfStudents" INTEGER NOT NULL,
    "numberOfTeachers" INTEGER NOT NULL,
    "website" TEXT,
    "contactName" TEXT,
    "contactRole" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT DEFAULT '',
    "eligibilityInformation" TEXT,
    "whyHelp" TEXT,
    "additionalInformation" TEXT,
    "submittedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "SchoolDevelopementProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EarlyAccessRequest" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "institutionSize" TEXT NOT NULL,

    CONSTRAINT "EarlyAccessRequest_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."File" ADD CONSTRAINT "File_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."File" ADD CONSTRAINT "File_schoolDevelopementProgramId_fkey" FOREIGN KEY ("schoolDevelopementProgramId") REFERENCES "public"."SchoolDevelopementProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
