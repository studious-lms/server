-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "modifiedAt" DATETIME,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT,
    "graded" BOOLEAN NOT NULL DEFAULT false,
    "maxGrade" INTEGER DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 1,
    "type" TEXT NOT NULL DEFAULT 'HOMEWORK',
    "inProgress" BOOLEAN NOT NULL DEFAULT false,
    "template" BOOLEAN NOT NULL DEFAULT false,
    "eventId" TEXT,
    "markSchemeId" TEXT,
    "gradingBoundaryId" TEXT,
    CONSTRAINT "Assignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE NO ACTION ON UPDATE CASCADE,
    CONSTRAINT "Assignment_markSchemeId_fkey" FOREIGN KEY ("markSchemeId") REFERENCES "MarkScheme" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_gradingBoundaryId_fkey" FOREIGN KEY ("gradingBoundaryId") REFERENCES "GradingBoundary" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Assignment" ("classId", "createdAt", "dueDate", "eventId", "graded", "gradingBoundaryId", "id", "inProgress", "instructions", "markSchemeId", "maxGrade", "modifiedAt", "sectionId", "teacherId", "title", "type", "weight") SELECT "classId", "createdAt", "dueDate", "eventId", "graded", "gradingBoundaryId", "id", "inProgress", "instructions", "markSchemeId", "maxGrade", "modifiedAt", "sectionId", "teacherId", "title", "type", "weight" FROM "Assignment";
DROP TABLE "Assignment";
ALTER TABLE "new_Assignment" RENAME TO "Assignment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
