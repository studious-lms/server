import nodemailer from 'nodemailer';
import { env } from '../lib/config/env.js';

export const transport = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: 587,
    secure: false,
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASS,
    },
  });
