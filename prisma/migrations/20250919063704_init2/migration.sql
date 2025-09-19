-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_receiverId_fkey";

-- DropForeignKey
ALTER TABLE "UserProfile" DROP CONSTRAINT "UserProfile_userId_fkey";

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "order" INTEGER;

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "color" TEXT DEFAULT '#3B82F6';

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "color" TEXT DEFAULT '#3B82F6',
ADD COLUMN     "order" INTEGER;

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "teacherComments" TEXT;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
