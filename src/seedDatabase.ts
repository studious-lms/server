import { prisma } from "./lib/prisma";
import { hash } from "bcryptjs";
import { logger } from "./utils/logger";

export async function clearDatabase() {
    await prisma.class.deleteMany();
    await prisma.userProfile.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
}

export async function createUser(email: string, password: string, username: string) {
    logger.debug("Creating user", { email, username, password });

    const hashedPassword = await hash(password, 10);
    return await prisma.user.create({
        data: { email, password: hashedPassword, username, verified: true },
    });
}

export async function addNotification(userId: string, title: string, content: string) {
    return await prisma.notification.create({
        data: {
            receiverId: userId,
            title,
            content,
        },
    });
}

export const seedDatabase = async () => {
    await clearDatabase();
    logger.info('Cleared database');

    // create two test users
    const teacher1 = await createUser('teacher1@studious.sh', '123456', 'teacher1');
    const student1 = await createUser('student1@studious.sh', '123456', 'student1');

    // create a class
    const class1 = await prisma.class.create({
        data: {
            name: 'Class 1',
            subject: 'Math',
            section: 'A',
            teachers: {
                connect: {
                    id: teacher1.id,
                }
            },
            students: {
                connect: {
                    id: student1.id,
                }
            }
        },
    });

    await addNotification(teacher1.id, 'Welcome to Studious', 'Welcome to Studious');
    await addNotification(student1.id, 'Welcome to Studious', 'Welcome to Studious');
};

(async () => {
    logger.info('Seeding database');
    await seedDatabase();
    logger.info('Database seeded');
})();