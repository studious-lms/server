import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';

export const labChatRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        classId: z.string(),
        title: z.string().min(1).max(200),
        context: z.string(), // JSON string for LLM context
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { classId, title, context } = input;

      // Verify user is a teacher in the class
      const classWithTeachers = await prisma.class.findFirst({
        where: {
          id: classId,
          teachers: {
            some: {
              id: userId,
            },
          },
        },
        include: {
          students: {
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
          teachers: {
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

      if (!classWithTeachers) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a teacher in this class',
        });
      }

      // Validate context is valid JSON
      try {
        JSON.parse(context);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Context must be valid JSON',
        });
      }

      // Create lab chat with associated conversation
      const result = await prisma.$transaction(async (tx) => {
        // Create conversation for the lab chat
        const conversation = await tx.conversation.create({
          data: {
            type: 'GROUP',
            name: `Lab: ${title}`,
            displayInChat: false, // Lab chats don't show in regular chat list
          },
        });

        // Add all class members to the conversation
        const allMembers = [
          ...classWithTeachers.teachers.map(t => ({ userId: t.id, role: 'ADMIN' as const })),
          ...classWithTeachers.students.map(s => ({ userId: s.id, role: 'MEMBER' as const })),
        ];

        await tx.conversationMember.createMany({
          data: allMembers.map(member => ({
            userId: member.userId,
            conversationId: conversation.id,
            role: member.role,
          })),
        });

        // Create the lab chat
        const labChat = await tx.labChat.create({
          data: {
            title,
            context,
            classId,
            conversationId: conversation.id,
            createdById: userId,
          },
          include: {
            conversation: {
              include: {
                members: {
                  include: {
                    user: {
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
                },
              },
            },
            createdBy: {
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
            class: {
              select: {
                id: true,
                name: true,
                subject: true,
                section: true,
              },
            },
          },
        });

        return labChat;
      });

      // Broadcast lab chat creation to class members
      try {
        await pusher.trigger(`class-${classId}`, 'lab-chat-created', {
          id: result.id,
          title: result.title,
          classId: result.classId,
          conversationId: result.conversationId,
          createdBy: result.createdBy,
          createdAt: result.createdAt,
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat creation:', error);
        // Don't fail the request if Pusher fails
      }

      return result;
    }),

  get: protectedProcedure
    .input(z.object({ labChatId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { labChatId } = input;

      const labChat = await prisma.labChat.findFirst({
        where: {
          id: labChatId,
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
            include: {
              members: {
                include: {
                  user: {
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
              },
            },
          },
          createdBy: {
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
          class: {
            select: {
              id: true,
              name: true,
              subject: true,
              section: true,
            },
          },
        },
      });

      if (!labChat) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Lab chat not found or access denied',
        });
      }

      return labChat;
    }),

  list: protectedProcedure
    .input(z.object({ classId: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { classId } = input;

      // Verify user is a member of the class
      const classMembership = await prisma.class.findFirst({
        where: {
          id: classId,
          OR: [
            {
              students: {
                some: {
                  id: userId,
                },
              },
            },
            {
              teachers: {
                some: {
                  id: userId,
                },
              },
            },
          ],
        },
      });

      if (!classMembership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this class',
        });
      }

      const labChats = await prisma.labChat.findMany({
        where: {
          classId,
        },
        include: {
          createdBy: {
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
          conversation: {
            include: {
              messages: {
                orderBy: {
                  createdAt: 'desc',
                },
                take: 1,
                include: {
                  sender: {
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
              _count: {
                select: {
                  messages: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return labChats.map((labChat) => ({
        id: labChat.id,
        title: labChat.title,
        classId: labChat.classId,
        conversationId: labChat.conversationId,
        createdBy: labChat.createdBy,
        createdAt: labChat.createdAt,
        updatedAt: labChat.updatedAt,
        lastMessage: labChat.conversation.messages[0] || null,
        messageCount: labChat.conversation._count.messages,
      }));
    }),

  postToLabChat: protectedProcedure
    .input(
      z.object({
        labChatId: z.string(),
        content: z.string().min(1).max(4000),
        mentionedUserIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { labChatId, content, mentionedUserIds = [] } = input;

      // Get lab chat and verify user is a member
      const labChat = await prisma.labChat.findFirst({
        where: {
          id: labChatId,
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
        },
      });

      if (!labChat) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Lab chat not found or access denied',
        });
      }

      // Verify mentioned users are members of the conversation
      if (mentionedUserIds.length > 0) {
        const mentionedMemberships = await prisma.conversationMember.findMany({
          where: {
            conversationId: labChat.conversationId,
            userId: { in: mentionedUserIds },
          },
        });

        if (mentionedMemberships.length !== mentionedUserIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Some mentioned users are not members of this lab chat',
          });
        }
      }

      // Create message and mentions
      const result = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            content,
            senderId: userId,
            conversationId: labChat.conversationId,
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

        // Update lab chat timestamp
        await tx.labChat.update({
          where: { id: labChatId },
          data: { updatedAt: new Date() },
        });

        return message;
      });

      // Broadcast to Pusher channel (using conversation ID)
      try {
        await pusher.trigger(`conversation-${labChat.conversationId}`, 'new-message', {
          id: result.id,
          content: result.content,
          senderId: result.senderId,
          conversationId: result.conversationId,
          createdAt: result.createdAt,
          sender: result.sender,
          mentionedUserIds,
          labChatId, // Include lab chat ID for frontend context
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat message:', error);
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
        labChatId,
      };
    }),

  delete: protectedProcedure
    .input(z.object({ labChatId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;
      const { labChatId } = input;

      // Verify user is the creator of the lab chat
      const labChat = await prisma.labChat.findFirst({
        where: {
          id: labChatId,
          createdById: userId,
        },
      });

      if (!labChat) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Lab chat not found or not the creator',
        });
      }

      // Delete lab chat and associated conversation
      await prisma.$transaction(async (tx) => {
        // Delete mentions first
        await tx.mention.deleteMany({
          where: {
            message: {
              conversationId: labChat.conversationId,
            },
          },
        });

        // Delete messages
        await tx.message.deleteMany({
          where: {
            conversationId: labChat.conversationId,
          },
        });

        // Delete conversation members
        await tx.conversationMember.deleteMany({
          where: {
            conversationId: labChat.conversationId,
          },
        });

        // Delete lab chat
        await tx.labChat.delete({
          where: { id: labChatId },
        });

        // Delete conversation
        await tx.conversation.delete({
          where: { id: labChat.conversationId },
        });
      });

      // Broadcast lab chat deletion
      try {
        await pusher.trigger(`class-${labChat.classId}`, 'lab-chat-deleted', {
          labChatId,
          classId: labChat.classId,
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat deletion:', error);
        // Don't fail the request if Pusher fails
      }

      return { success: true };
    }),
});
