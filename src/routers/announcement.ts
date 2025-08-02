import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import redis from "../lib/redis";
import {
  createTRPCRouter,
  protectedClassMemberProcedure,
  protectedProcedure,
  protectedTeacherProcedure,
} from "../trpc";

const CACHE_KEY = "announcement:all";

const AnnouncementSelect = {
  id: true,
  teacher: {
    select: {
      id: true,
      username: true,
    },
  },
  remarks: true,
  createdAt: true,
};

export const announcementRouter = createTRPCRouter({
  getAll: protectedClassMemberProcedure
    .input(
      z.object({
        classId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Try getting data from Redis
      const cached = await redis.get(CACHE_KEY);
      console.log("announcement Cache hit:", cached);
      if (cached) {
        return JSON.parse(cached);
      }

      const announcements = await prisma.announcement.findMany({
        where: {
          classId: input.classId,
        },
        select: AnnouncementSelect,
        orderBy: {
          createdAt: "desc",
        },
      });

      const data = {
        announcements,
      };

      // Store in Redis (set cache for 10 mins)
      await redis.set(CACHE_KEY, JSON.stringify(data), {
        EX: 600, // 600 seconds = 10 minutes
      });

      return data;
    }),

  create: protectedTeacherProcedure
    .input(
      z.object({
        classId: z.string(),
        remarks: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await redis.del(CACHE_KEY);

      const announcement = await prisma.announcement.create({
        data: {
          remarks: input.remarks,
          teacher: {
            connect: {
              id: ctx.user?.id,
            },
          },
          class: {
            connect: {
              id: input.classId,
            },
          },
        },
        select: AnnouncementSelect,
      });

      return {
        announcement,
      };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          content: z.string(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await redis.del(CACHE_KEY);

      const announcement = await prisma.announcement.findUnique({
        where: { id: input.id },
        include: {
          class: {
            include: {
              teachers: true,
            },
          },
        },
      });

      if (!announcement) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Announcement not found",
        });
      }

      const updatedAnnouncement = await prisma.announcement.update({
        where: { id: input.id },
        data: {
          remarks: input.data.content,
        },
      });

      return { announcement: updatedAnnouncement };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await redis.del(CACHE_KEY);

      const announcement = await prisma.announcement.findUnique({
        where: { id: input.id },
        include: {
          class: {
            include: {
              teachers: true,
            },
          },
        },
      });

      if (!announcement) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Announcement not found",
        });
      }

      await prisma.announcement.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});
