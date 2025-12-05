import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';
import { 
  inferenceClient,
  openAIClient,
  sendAIMessage,
} from '../utils/inference.js';
import { logger } from '../utils/logger.js';
import { isAIUser } from '../utils/aiUser.js';

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

        return newtonChat;
      });

      // Generate AI introduction message in parallel (don't await - fire and forget)
      generateAndSendNewtonIntroduction(
        result.id,
        result.conversationId,
        submission.id
      ).catch(error => {
        logger.error('Failed to generate AI introduction:', { error, newtonChatId: result.id });
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

/**
 * Generate and send AI introduction for Newton chat
 */
async function generateAndSendNewtonIntroduction(
  newtonChatId: string,
  conversationId: string,
  submissionId: string
): Promise<void> {
  try {
    // Get submission details for context
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: {
          select: {
            title: true,
            instructions: true,
            class: {
              select: {
                subject: true,
                name: true,
              },
            },
          },
        },
        attachments: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    if (!submission) {
      throw new Error('Submission not found');
    }

    const systemPrompt = `You are Newton, an AI tutor helping a student with their assignment submission. 

Assignment: ${submission.assignment.title}
Subject: ${submission.assignment.class.subject}
Instructions: ${submission.assignment.instructions || 'No specific instructions provided'}

Your role:
- Help the student understand concepts related to their assignment
- Provide guidance and explanations without giving away direct answers
- Encourage learning and critical thinking
- Be supportive and encouraging
- Use clear, educational language appropriate for the subject

Do not use markdown formatting in your responses - use plain text only.`;

    const completion = await inferenceClient.chat.completions.create({
      model: 'command-a-03-2025',
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: 'Please introduce yourself to the student. Explain that you are Newton, their AI tutor, and you are here to help them with their assignment. Ask them what they would like help with.' 
        },
      ],
      max_tokens: 300,
      temperature: 0.8,
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response generated from inference API');
    }

    // Send AI introduction using centralized sender
    await sendAIMessage(response, conversationId, {
      subject: submission.assignment.class.subject || 'Assignment',
    });

    logger.info('AI Introduction sent', { newtonChatId, conversationId });

  } catch (error) {
    logger.error('Failed to generate AI introduction:', { error, newtonChatId });
    
    // Send fallback introduction
    try {
      const fallbackIntro = `Hello! I'm Newton, your AI tutor. I'm here to help you with your assignment. I can answer questions, explain concepts, and guide you through your work. What would you like help with today?`;
      
      await sendAIMessage(fallbackIntro, conversationId, {
        subject: 'Assignment',
      });

      logger.info('Fallback AI introduction sent', { newtonChatId });

    } catch (fallbackError) {
      logger.error('Failed to send fallback AI introduction:', { error: fallbackError, newtonChatId });
    }
  }
}

/**
 * Generate and send AI response to student message
 */
async function generateAndSendNewtonResponse(
  newtonChatId: string,
  studentMessage: string,
  conversationId: string,
  submission: {
    id: string;
    assignment: {
      id: string;
      title: string;
      instructions: string | null;
      class: {
        subject: string | null;
      };
    };
  }
): Promise<void> {
  try {
    // Get recent conversation history
    const recentMessages = await prisma.message.findMany({
      where: {
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
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10, // Last 10 messages for context
    });

    const systemPrompt = `You are Newton, an AI tutor helping a student with their assignment submission. 

Assignment: ${submission.assignment.title}
Subject: ${submission.assignment.class.subject || 'General'}
Instructions: ${submission.assignment.instructions || 'No specific instructions provided'}

Your role:
- Help the student understand concepts related to their assignment
- Provide guidance and explanations without giving away direct answers
- Encourage learning and critical thinking
- Be supportive and encouraging
- Use clear, educational language appropriate for the subject
- If the student asks for direct answers, guide them to think through the problem instead
- Break down complex concepts into simpler parts
- Use examples and analogies when helpful

IMPORTANT:
- Do not use markdown formatting in your responses - use plain text only
- Keep responses conversational and educational
- Focus on helping the student learn, not just completing the assignment`;

    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add recent conversation history
    recentMessages.reverse().forEach(msg => {
      const role = isAIUser(msg.senderId) ? 'assistant' : 'user';
      const senderName = msg.sender?.profile?.displayName || msg.sender?.username || 'Student';
      const content = isAIUser(msg.senderId) ? msg.content : `${senderName}: ${msg.content}`;
      
      messages.push({
        role: role as 'user' | 'assistant',
        content,
      });
    });

    // Add the new student message
    messages.push({
      role: 'user',
      content: `Student: ${studentMessage}`,
    });

    const completion = await openAIClient.chat.completions.create({
      model: 'gpt-5-nano',
      messages,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response generated from inference API');
    }

    // Send the text response to the conversation
    await sendAIMessage(response, conversationId, {
      subject: submission.assignment.class.subject || 'Assignment',
    });

    logger.info('AI response sent', { newtonChatId, conversationId });

  } catch (error) {
    logger.error('Failed to generate AI response:', { 
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      newtonChatId 
    });
  }
}


