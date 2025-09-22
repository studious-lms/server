-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "role" "ConversationRole" NOT NULL DEFAULT 'MEMBER';
