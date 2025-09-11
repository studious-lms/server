import { createTRPCRouter, protectedProcedure } from "../trpc.js";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

export const notificationRouter = createTRPCRouter({
    list: protectedProcedure.query(async ({ ctx }) => {
        const notifications = await prisma.notification.findMany({
            where: {
                receiverId: ctx.user!.id,
            },
            orderBy: {
                createdAt: "desc",
            },
            include: {
                sender: {
                    select: {
                        username: true,
                    },
                },
                receiver: {
                    select: {
                        username: true,
                    },
                },
            },
        });

        return notifications;
    }),
    get: protectedProcedure.input(z.object({
        id: z.string(),
    })).query(async ({ ctx, input }) => {
        const { id } = input;
        const notification = await prisma.notification.findUnique({
            where: {
                id,
            },
            include: {
                sender: {
                    select: {
                        username: true,
                    },
                },
                receiver: {
                    select: {
                        username: true,
                    },
                },
            },
        });
        return notification;
    }),
    sendTo: protectedProcedure.input(z.object({
        receiverId: z.string(),
        title: z.string(),
        content: z.string(),
    })).mutation(async ({ ctx, input }) => {
        const { receiverId, title, content } = input;
        const notification = await prisma.notification.create({
            data: {
                receiverId,
                title,
                content,
            },
        });
        return notification;
    }),
    sendToMultiple: protectedProcedure.input(z.object({
        receiverIds: z.array(z.string()),
        title: z.string(),
        content: z.string(),
    })).mutation(async ({ ctx, input }) => {
        const { receiverIds, title, content } = input;
        const notifications = await prisma.notification.createMany({
            data: receiverIds.map(receiverId => ({
                receiverId,
                title,
                content,
            })),
        });
        return notifications;
    }),
    markAsRead: protectedProcedure.input(z.object({
        id: z.string(),
    })).mutation(async ({ ctx, input }) => {
        const { id } = input;
        const notification = await prisma.notification.update({
            where: { id },
            data: { read: true },
        });
        return notification;
    }),
})
