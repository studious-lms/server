import { z } from "zod";
import { prisma } from "../lib/prisma.js";

interface notificationData {
    title: string,
    content: string
}

export async function sendNotification(receiver: string, data: notificationData) {
    try {
        const notification = await prisma.notification.create({
            data: {
                receiverId: receiver,
                title: data.title,
                content: data.content,
            },
        });
        return notification;
    } catch (notificationError) {
        console.error('Failed to send assignment notification:', notificationError)
    }
}

export async function sendNotifications(receiverIds: Array<string>, data: notificationData) {
    try {
        const notifications = await prisma.notification.createMany({
            data: receiverIds.map(receiverId => ({
                receiverId: receiverId,
                title: data.title,
                content: data.content,
            })),
        });
        return notifications;
    } catch (notificationError) {
        console.error('Failed to send assignment notifications:', notificationError)
    }
}

export async function markRead(id: string, read: boolean = true) {
    const notification = await prisma.notification.update({
        where: {id},
        data: {read: read},
    });
    return notification;
}
