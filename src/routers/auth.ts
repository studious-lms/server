import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { prisma } from "../lib/prisma";
import { v4 as uuidv4 } from 'uuid';
import { compare, hash } from "bcryptjs";
import { transport } from "../utils/email";

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const { username, email, password } = input;

      // Check if username already exists
      const existingUser = await prisma.user.findFirst({
        where: { 
          OR: [
            { username },
            { email }
          ]
        },
        select: {
          id: true,
          username: true,
          email: true,
          verified: true,
        }
      });

      if (existingUser && existingUser.verified) {
        if (existingUser.username === username) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Username already exists",
          });
        }
        if (existingUser.email === email) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Email already exists",
          });
        }
      } else if (existingUser && !existingUser.verified) {
        await prisma.session.deleteMany({
          where: { userId: existingUser.id },
        });

        await prisma.user.delete({
          where: { id: existingUser.id },
        });
      }

      // Create new user
      const user = await prisma.user.create({
        data: {
          username,
          email,
          password: await hash(password, 10),
          profile: {},
        },
        select: {
          id: true,
          username: true,
          email: true,
        }
      });

      const verificationToken = await prisma.session.create({
        data: {
          id: uuidv4(),
          userId: user.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
      });

      await transport.sendMail({
        from: 'noreply@studious.sh',
        to: user.email,
        subject: 'Verify your email',
        text: `Click the link to verify your email: ${process.env.NEXT_PUBLIC_APP_URL}/verify/${verificationToken.id}`,
      });

      return {
        user: {
          id: user.id,
          username: user.username,
        },
      };
    }),

  login: publicProcedure
    .input(loginSchema)
    .mutation(async ({ input }) => {
      const { username, password } = input;

      const user = await prisma.user.findFirst({
        where: { username },
        select: {
          id: true,
          username: true,
          password: true,
          email: true,
          verified: true,
        }
      });

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      if (await compare(password, user.password)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      if (!user.verified) {
        return {
          verified: false,
          user: {
            email: user.email,
          },
        }
      }

      // Create a new session
      const session = await prisma.session.create({
        data: {
          id: uuidv4(),
          userId: user.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        },
      });

      return {
        token: session.id,
        user: {
          id: user.id,
          username: user.username,
        },
      };
    }),

  logout: publicProcedure
    .mutation(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }

      // Delete the current session
      await prisma.session.deleteMany({
        where: { userId: ctx.user.id },
      });

      return { success: true };
    }),

  check: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: {
          id: true,
          username: true,
        }
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return {user};
    }),
    resendVerificationEmail: publicProcedure
      .input(z.object({
        email: z.string().email(),
      }))
      .mutation(async ({ input }) => {
        const { email } = input;

        const user = await prisma.user.findFirst({
          where: { 
            email,
           },
          select: {
            id: true,
            email: true,
          },
        });

        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        await prisma.session.deleteMany({
          where: { userId: user?.id },
        });

        const verificationToken = await prisma.session.create({
          data: {
            id: uuidv4(),
            userId: user.id,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
          },
        });
        
        await transport.sendMail({
          from: 'noreply@studious.sh',
          to: user.email,
          subject: 'Verify your email',
          text: `Click the link to verify your email: ${process.env.NEXT_PUBLIC_APP_URL}/verify/${verificationToken.id}`,
        });

        return { success: true };
      }),
    verify: publicProcedure
      .input(z.object({
        token: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { token } = input;

        const session = await prisma.session.findUnique({
          where: { id: token },
        });

        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Session not found",
          });
        }

        if (session.expiresAt && session.expiresAt < new Date()) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Session expired",
          });
        }

        await prisma.user.update({
          where: { id: session.userId! },
          data: {
            verified: true,
          },
        });

        return { success: true };
      }),
}); 