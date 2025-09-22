import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';

export const messageRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId, cursor, limit } = input;

      // Verify user is a member of the conversation
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          ...(cursor && {
            createdAt: {
              lt: new Date(cursor),
            },
          }),
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
          mentions: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profile: {
                    select: {
                      displayName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit + 1,
      });

      let nextCursor: string | undefined = undefined;
      if (messages.length > limit) {
        const nextItem = messages.pop();
        nextCursor = nextItem!.createdAt.toISOString();
      }

      return {
        messages: messages.reverse().map((message) => ({
          id: message.id,
          content: message.content,
          senderId: message.senderId,
          conversationId: message.conversationId,
          createdAt: message.createdAt,
          sender: message.sender,
          mentions: message.mentions.map((mention) => ({
            user: mention.user,
          })),
          mentionsMe: message.mentions.some((mention) => mention.userId === userId),
        })),
        nextCursor,
      };
    }),

  send: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        content: z.string().min(1).max(4000),
        mentionedUserIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId, content, mentionedUserIds = [] } = input;

      // Verify user is a member of the conversation
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Verify mentioned users are members of the conversation
      if (mentionedUserIds.length > 0) {
        const mentionedMemberships = await prisma.conversationMember.findMany({
          where: {
            conversationId,
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

      // Create message, mentions, and update conversation timestamp
      const result = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            content,
            senderId: userId,
            conversationId,
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

        // Update conversation timestamp
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      // Broadcast to Pusher channel
      try {
        await pusher.trigger(`conversation-${conversationId}`, 'new-message', {
          id: result.id,
          content: result.content,
          senderId: result.senderId,
          conversationId: result.conversationId,
          createdAt: result.createdAt,
          sender: result.sender,
          mentionedUserIds,
        });
      } catch (error) {
        console.error('Failed to broadcast message:', error);
        // Don't fail the request if Pusher fails
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

  markAsRead: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      // Verify user is a member of the conversation and update lastViewedAt
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Update the user's lastViewedAt timestamp for this conversation
      await prisma.conversationMember.update({
        where: {
          id: membership.id,
        },
        data: {
          lastViewedAt: new Date(),
        },
      });

      // Broadcast that user has viewed the conversation
      try {
        await pusher.trigger(`conversation-${conversationId}`, 'conversation-viewed', {
          userId,
          viewedAt: new Date(),
        });
      } catch (error) {
        console.error('Failed to broadcast conversation view:', error);
        // Don't fail the request if Pusher fails
      }

      return { success: true };
    }),

  markMentionsAsRead: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      // Verify user is a member of the conversation and update lastViewedMentionAt
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Update the user's lastViewedMentionAt timestamp for this conversation
      await prisma.conversationMember.update({
        where: {
          id: membership.id,
        },
        data: {
          lastViewedMentionAt: new Date(),
        },
      });

      // Broadcast that user has viewed mentions
      try {
        await pusher.trigger(`conversation-${conversationId}`, 'mentions-viewed', {
          userId,
          viewedAt: new Date(),
        });
      } catch (error) {
        console.error('Failed to broadcast mentions view:', error);
        // Don't fail the request if Pusher fails
      }

      return { success: true };
    }),

  getUnreadCount: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { conversationId } = input;

      // Get user's membership with lastViewedAt and lastViewedMentionAt
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId,
          userId,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this conversation',
        });
      }

      // Count regular unread messages
      const unreadCount = await prisma.message.count({
        where: {
          conversationId,
          senderId: { not: userId },
          ...(membership.lastViewedAt && {
            createdAt: { gt: membership.lastViewedAt }
          }),
        },
      });

      // Count unread mentions
      const unreadMentionCount = await prisma.mention.count({
        where: {
          userId,
          message: {
            conversationId,
            senderId: { not: userId },
            ...(membership.lastViewedMentionAt && {
              createdAt: { gt: membership.lastViewedMentionAt }
            }),
          },
        },
      });

      return { 
        unreadCount, 
        unreadMentionCount 
      };
    }),
});
