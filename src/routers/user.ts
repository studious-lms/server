import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { prisma } from "@lib/prisma";
import { uploadFiles, type UploadedFile } from "@lib/fileUpload";

const fileSchema = z.object({
  name: z.string(),
  type: z.string(),
  size: z.number(),
  data: z.string(), // base64 encoded file data
});

const updateProfileSchema = z.object({
  profile: z.record(z.any()),
  profilePicture: fileSchema.optional(),
});

export const userRouter = createTRPCRouter({
  getProfile: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          username: true,
          profile: true,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return user;
    }),

  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User must be authenticated",
        });
      }

      let uploadedFiles: UploadedFile[] = [];
      if (input.profilePicture) {
        // Store profile picture in a user-specific directory
        uploadedFiles = await uploadFiles([input.profilePicture], ctx.user.id, `users/${ctx.user.id}/profile`);
        
        // Add profile picture path to profile data
        input.profile.profilePicture = uploadedFiles[0].path;
        input.profile.profilePictureThumbnail = uploadedFiles[0].thumbnailId;
      }

      const updatedUser = await prisma.user.update({
        where: { id: ctx.user.id },
        data: {
          profile: input.profile,
        },
        select: {
          id: true,
          username: true,
          profile: true,
        },
      });

      return updatedUser;
    }),
}); 