import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';
import { logger } from '../utils/logger.js';
import { isAIUser } from '../utils/aiUser.js';
import { generateAndSendNewtonIntroduction, generateAndSendNewtonResponse } from '../server/pipelines/aiNewtonChat.js';

export const newtonChatRouter = createTRPCRouter({
  getTutorConversation: protectedProcedure
    .input(
      z.object({
        assignmentId: z.string(),
        classId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { assignmentId, classId } = input;

      // Verify user is a student in the class
      const classMembership = await prisma.class.findFirst({
        where: {
          id: classId,
          students: {
            some: {
              id: userId,
            },
          },
        },
      });

      if (!classMembership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a student in this class',
        });
      }

      // Find or create submission for this student and assignment
      const submission = await prisma.submission.findFirst({
        where: {
          assignmentId,
          studentId: userId,
        },
      });

      if (!submission) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Submission not found. Please create a submission first.',
        });
      }

      // Find the latest NewtonChat for this submission, or create a new one
      const result = await prisma.$transaction(async (tx) => {
        // Get the latest NewtonChat for this submission
        const existingNewtonChat = await tx.newtonChat.findFirst({
          where: {
            submissionId: submission.id,
          },
          include: {
            conversation: {
              include: {
                members: {
                  where: {
                    userId,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        // If exists and user is already a member, return it
        if (existingNewtonChat && existingNewtonChat.conversation.members.length > 0) {
          return existingNewtonChat;
        }

        // If exists but user is not a member, add them
        if (existingNewtonChat) {
          await tx.conversationMember.create({
            data: {
              userId,
              conversationId: existingNewtonChat.conversationId,
              role: 'MEMBER',
            },
          });

          return existingNewtonChat;
        }

        // Create new NewtonChat with associated conversation
        const conversation = await tx.conversation.create({
          data: {
            type: 'DM',
            name: 'Session with Newton Tutor',
            displayInChat: false, // Newton chats don't show in regular chat list
          },
        });

        // Add student to the conversation
        await tx.conversationMember.create({
          data: {
            userId,
            conversationId: conversation.id,
            role: 'MEMBER',
          },
        });

        // Create the NewtonChat
        const newtonChat = await tx.newtonChat.create({
          data: {
            submissionId: submission.id,
            conversationId: conversation.id,
            title: 'Session with Newton Tutor',
          },
        });
        generateAndSendNewtonIntroduction(
          newtonChat.id,
          newtonChat.conversationId,
          submission.id
        ).catch(error => {
          logger.error('Failed to generate AI introduction:', { error, newtonChatId: result.id });
        });

        return newtonChat;
      });

      return {
        conversationId: result.conversationId,
        newtonChatId: result.id,
      };
    }),

  postToNewtonChat: protectedProcedure
    .input(
      z.object({
        newtonChatId: z.string(),
        content: z.string().min(1).max(4000),
        mentionedUserIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { newtonChatId, content, mentionedUserIds = [] } = input;

      // Get newton chat and verify user is a member
      const newtonChat = await prisma.newtonChat.findFirst({
        where: {
          id: newtonChatId,
          conversation: {
            members: {
              some: {
                userId,
              },
            },
          },
        },
        include: {
          conversation: {
            select: {
              id: true,
            },
          },
          submission: {
            include: {
              assignment: {
                select: {
                  id: true,
                  title: true,
                  instructions: true,
                  class: {
                    select: {
                      subject: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!newtonChat) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Newton chat not found or access denied',
        });
      }

      // Verify mentioned users are members of the conversation
      if (mentionedUserIds.length > 0) {
        const mentionedMemberships = await prisma.conversationMember.findMany({
          where: {
            conversationId: newtonChat.conversationId,
            userId: { in: mentionedUserIds },
          },
        });

        if (mentionedMemberships.length !== mentionedUserIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Some mentioned users are not members of this conversation',
          });
        }
      }

      // Create message and mentions
      const result = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            content,
            senderId: userId,
            conversationId: newtonChat.conversationId,
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profile: {
                  select: {
                    displayName: true,
                    profilePicture: true,
                  },
                },
              },
            },
          },
        });

        // Create mentions
        if (mentionedUserIds.length > 0) {
          await tx.mention.createMany({
            data: mentionedUserIds.map((mentionedUserId) => ({
              messageId: message.id,
              userId: mentionedUserId,
            })),
          });
        }

        // Update newton chat timestamp
        await tx.newtonChat.update({
          where: { id: newtonChatId },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      // Broadcast to Pusher channel (same format as regular chat)
      try {
        await pusher.trigger(`conversation-${newtonChat.conversationId}`, 'new-message', {
          id: result.id,
          content: result.content,
          senderId: result.senderId,
          conversationId: result.conversationId,
          createdAt: result.createdAt,
          sender: result.sender,
          mentionedUserIds,
        });
      } catch (error) {
        console.error('Failed to broadcast newton chat message:', error);
        // Don't fail the request if Pusher fails
      }

      // Generate AI response in parallel (don't await - fire and forget)
      if (!isAIUser(userId)) {
        // Run AI response generation in background
        generateAndSendNewtonResponse(
          newtonChatId,
          content,
          newtonChat.conversationId,
          newtonChat.submission
        ).catch(error => {
          logger.error('Failed to generate AI response:', { error });
        });
      }

      return {
        id: result.id,
        content: result.content,
        senderId: result.senderId,
        conversationId: result.conversationId,
        createdAt: result.createdAt,
        sender: result.sender,
        mentionedUserIds,
      };
    }),
});


