import nodemailer from 'nodemailer';
import { env } from '../lib/config/env.js';
import { logger } from './logger.js';


export const transport = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: 587,
    secure: false,
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASS,
    },
  });


export const sendMail = async ({ from, to, subject, text }: { from: string, to: string, subject: string, text: string }) => {
  // Wrapper function for sending emails
  // Commented sending email since the system is not setup yet
  logger.info(`Sending email to ${to} from ${from} with subject ${subject} and text ${text}`);
  // await transport.sendMail({
  //   from,
  //   to,
  //   subject,
  //   text,
  // });
};
