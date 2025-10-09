import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc.js';
import { prisma } from '../lib/prisma.js';
import { pusher } from '../lib/pusher.js';
import { TRPCError } from '@trpc/server';
import { 
  inferenceClient,
  sendAIMessage,
  type LabChatContext 
} from '../utils/inference.js';
import { logger } from '../utils/logger.js';
import { isAIUser } from '../utils/aiUser.js';
import { uploadFile } from 'src/lib/googleCloudStorage.js';
import { createPdf } from "src/lib/jsonConversion.js"
import OpenAI from 'openai';
import { zodResponseFormat } from "openai/helpers/zod";
import { v4 as uuidv4 } from "uuid";

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

        // Add only teachers to the conversation (this is for course material creation)
        const teacherMembers = classWithTeachers.teachers.map(t => ({ 
          userId: t.id, 
          role: 'ADMIN' as const 
        }));

        await tx.conversationMember.createMany({
          data: teacherMembers.map(member => ({
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

      // Generate AI introduction message in parallel (don't await - fire and forget)
      generateAndSendLabIntroduction(result.id, result.conversationId, context, classWithTeachers.subject || 'Lab').catch(error => {
        logger.error('Failed to generate AI introduction:', { error, labChatId: result.id });
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

      // First, try to find the lab chat if user is already a member
      let labChat = await prisma.labChat.findFirst({
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

      // If not found, check if user is a teacher in the class
      if (!labChat) {
        const labChatForTeacher = await prisma.labChat.findFirst({
          where: {
            id: labChatId,
            class: {
              teachers: {
                some: {
                  id: userId,
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

        if (labChatForTeacher) {
          // Add teacher to conversation
          await prisma.conversationMember.create({
            data: {
              userId,
              conversationId: labChatForTeacher.conversation.id,
              role: 'ADMIN',
            },
          });

          // Now fetch the full lab chat with the user as a member
          labChat = await prisma.labChat.findFirst({
            where: {
              id: labChatId,
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
        }
      }

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

      // Broadcast to Pusher channel (same format as regular chat)
      try {
        await pusher.trigger(`conversation-${labChat.conversationId}`, 'new-message', {
          id: result.id,
          content: result.content,
          senderId: result.senderId,
          conversationId: result.conversationId,
          createdAt: result.createdAt,
          sender: result.sender,
          mentionedUserIds,
        });
      } catch (error) {
        console.error('Failed to broadcast lab chat message:', error);
        // Don't fail the request if Pusher fails
      }

        // Generate AI response in parallel (don't await - fire and forget)
        if (!isAIUser(userId)) {
          // Run AI response generation in background
          generateAndSendLabResponse(labChatId, content, labChat.conversationId).catch(error => {
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

/**
 * Generate and send AI introduction for lab chat
 * Uses the stored context directly from database
 */
async function generateAndSendLabIntroduction(
  labChatId: string,
  conversationId: string,
  contextString: string,
  subject: string
): Promise<void> {
  try {
    // Enhance the stored context with clarifying question instructions
    const enhancedSystemPrompt = `${contextString}

IMPORTANT INSTRUCTIONS:
- You are helping teachers create course materials
- Use the context information provided above (subject, topic, difficulty, objectives, etc.) as your foundation
- Only ask clarifying questions about details NOT already specified in the context
- Focus your questions on format preferences, specific requirements, or missing details needed to create the content
- Only output final course materials when you have sufficient details beyond what's in the context
- Do not use markdown formatting in your responses - use plain text only
- When creating content, make it clear and well-structured without markdown`;

    const completion = await inferenceClient.chat.completions.create({
      model: 'command-a-03-2025',
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        { 
          role: 'user', 
          content: 'Please introduce yourself to the teaching team. Explain that you will help create course materials by first asking clarifying questions based on the context provided, and only output final content when you have enough information.' 
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
      subject,
    });

    logger.info('AI Introduction sent', { labChatId, conversationId });

  } catch (error) {
    logger.error('Failed to generate AI introduction:', { error, labChatId });
    
    // Send fallback introduction
    try {
      const fallbackIntro = `Hello teaching team! I'm your AI assistant for course material development. I will help you create educational content by first asking clarifying questions based on the provided context, then outputting final materials when I have sufficient information. I won't use markdown formatting in my responses. What would you like to work on?`;
      
      await sendAIMessage(fallbackIntro, conversationId, {
        subject,
      });

      logger.info('Fallback AI introduction sent', { labChatId });

    } catch (fallbackError) {
      logger.error('Failed to send fallback AI introduction:', { error: fallbackError, labChatId });
    }
  }
}

/**
 * Generate and send AI response to teacher message
 * Uses the stored context directly from database
 */
async function generateAndSendLabResponse(
  labChatId: string,
  teacherMessage: string,
  conversationId: string
): Promise<void> {
  try {
    // Get lab context from database
    const fullLabChat = await prisma.labChat.findUnique({
      where: { id: labChatId },
      include: {
        class: {
          select: {
            name: true,
            subject: true,
          },
        },
      },
    });

    if (!fullLabChat) {
      throw new Error('Lab chat not found');
    }

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

    // Build conversation history as proper message objects
    // Enhance the stored context with clarifying question instructions
    const enhancedSystemPrompt = `${fullLabChat.context}

IMPORTANT INSTRUCTIONS:
- You must output ONLY a JSON object that matches this schema (no prose, no markdown):
- Schema: { "blocks": [ { "format": <int 0-12>, "content": string | string[], "metadata"?: { fontSize?: number, lineHeight?: number, paragraphSpacing?: number, indentWidth?: number, paddingX?: number, paddingY?: number, font?: 0|1|2|3|4|5, color?: "#RGB"|"#RRGGBB", background?: "#RGB"|"#RRGGBB", align?: "left"|"center"|"right" } } ] }
- Format enum (integers): 0=HEADER_1, 1=HEADER_2, 2=HEADER_3, 3=HEADER_4, 4=HEADER_5, 5=HEADER_6, 6=PARAGRAPH, 7=BULLET, 8=NUMBERED, 9=TABLE, 10=IMAGE, 11=CODE_BLOCK, 12=QUOTE
- Fonts enum: 0=TIMES_ROMAN, 1=COURIER, 2=HELVETICA, 3=HELVETICA_BOLD, 4=HELVETICA_ITALIC, 5=HELVETICA_BOLD_ITALIC
- Colors must be hex strings: "#RGB" or "#RRGGBB".
- Headings (0-5): content is a single string; you may set metadata.align.
- Paragraphs (6) and Quotes (12): content is a single string.
- Bullets (7) and Numbered (8): content is an array of strings (one item per list entry).
- Code blocks (11): prefer content as an array of lines; preserve indentation via leading tabs/spaces. If using a single string, include \n between lines.
- Table (9) and Image (10) are not supported by the renderer now; do not emit them.
- Use metadata sparingly; omit fields you don't need. For code blocks you may set metadata.paddingX, paddingY, background, and font (1 for Courier).
- Wrap text naturally; do not insert manual line breaks except where semantically required (lists, code).
- The JSON must be valid and ready for PDF rendering by the server.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: enhancedSystemPrompt },
    ];

    // Add recent conversation history
    recentMessages.reverse().forEach(msg => {
      const role = isAIUser(msg.senderId) ? 'assistant' : 'user';
      const senderName = msg.sender?.profile?.displayName || msg.sender?.username || 'Teacher';
      const content = isAIUser(msg.senderId) ? msg.content : `${senderName}: ${msg.content}`;
      
      messages.push({
        role: role as 'user' | 'assistant',
        content,
      });
    });

    // Add the new teacher message
    const senderName = 'Teacher'; // We could get this from the actual sender if needed
    messages.push({
      role: 'user',
      content: `${senderName}: ${teacherMessage}`,
    });

    const pdfFormat = z.object({
      blocks: z.array(
        z.object({
          // FormatTypes enum as integer (see src/lib/jsonStyles.ts)
          // 0: HEADER_1, 1: HEADER_2, 2: HEADER_3, 3: HEADER_4, 4: HEADER_5, 5: HEADER_6,
          // 6: PARAGRAPH, 7: BULLET, 8: NUMBERED, 9: TABLE, 10: IMAGE, 11: CODE_BLOCK, 12: QUOTE
          format: z.number().int().min(0).max(12),

          // Content can be a single string or an array of strings
          // - string: paragraphs, headings, quotes, code block (can contain \n)
          // - string[]: bullets, numbered lists, or explicit code lines
          content: z.union([z.string(), z.array(z.string())]),

          // Optional rendering metadata used by the PDF generator
          metadata: z
            .object({
              fontSize: z.number().min(6).optional(),
              lineHeight: z.number().min(0.6).optional(),
              paragraphSpacing: z.number().min(0).optional(),
              indentWidth: z.number().min(0).optional(),
              paddingX: z.number().min(0).optional(),
              paddingY: z.number().min(0).optional(),

              // Fonts enum (see src/lib/jsonStyles.ts -> Fonts)
              // 0: TIMES_ROMAN, 1: COURIER, 2: HELVETICA, 3: HELVETICA_BOLD,
              // 4: HELVETICA_ITALIC, 5: HELVETICA_BOLD_ITALIC
              font: z.number().int().min(0).max(5).optional(),

              // Colors as hex strings (#RGB or #RRGGBB)
              color: z
                .string()
                .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
                .optional(),
              background: z
                .string()
                .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
                .optional(),

              // Headings alignment
              align: z.enum(["left", "center", "right"]).optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
      ),
    }).strict()

    const completion = await inferenceClient.chat.completions.create({
      model: 'command-a-03-2025',
      messages,
      max_tokens: 500,
      temperature: 0.7,
      response_format: zodResponseFormat(pdfFormat, "pdfFormat"),
    });

    const response = completion.choices[0]?.message?.content;
    
    if (!response) {
      throw new Error('No response generated from inference API');
    }

    // Parse the JSON response and generate PDF
    try {
      const jsonData = JSON.parse(response);
      if (jsonData.blocks && Array.isArray(jsonData.blocks)) {
        let pdfBytes = await createPdf(jsonData.blocks);
        logger.info('PDF generated successfully', { labChatId });
        uploadFile(Buffer.from(pdfBytes).toString('base64'), `${uuidv4()}.pdf`, 'application/pdf')
      }
    } catch (parseError) {
      logger.error('Failed to parse AI response or generate PDF:', { error: parseError, labChatId });
    }

    // Send AI response
    await sendAIMessage(response, conversationId, {
      subject: fullLabChat.class?.subject || 'Lab',
    });

    logger.info('AI response sent', { labChatId, conversationId });

  } catch (error) {
    logger.error('Failed to generate AI response:', { error, labChatId });
  }
}

