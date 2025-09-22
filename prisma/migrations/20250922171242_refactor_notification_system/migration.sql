/*
  Warnings:

  - You are about to drop the `MessageRead` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MessageRead" DROP CONSTRAINT "MessageRead_messageId_fkey";

-- DropForeignKey
ALTER TABLE "MessageRead" DROP CONSTRAINT "MessageRead_userId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "displayInChat" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "lastViewedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "MessageRead";
