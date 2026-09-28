import nodemailer, { Transporter } from "nodemailer";
import { Sender } from "../types";

const transporterCache = new Map<number, Transporter>();

function getTransporter(sender: Sender): Transporter {
  const cached = transporterCache.get(sender.id);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: false,
    auth: {
      user: sender.smtpUser,
      pass: sender.smtpPass,
    },
  });
  transporterCache.set(sender.id, transporter);
  return transporter;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | false;
}

export async function sendEmail(
  sender: Sender,
  to: string,
  subject: string,
  html: string
): Promise<SendResult> {
  const transporter = getTransporter(sender);
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to,
    subject,
    html,
  });
  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
}

/**
 * Creates a fresh Ethereal (fake SMTP) test account. Used so the app can
 * support "multiple senders" without requiring real mailbox credentials.
 */
export async function createEtherealAccount(): Promise<{
  user: string;
  pass: string;
  host: string;
  port: number;
}> {
  const testAccount = await nodemailer.createTestAccount();
  return {
    user: testAccount.user,
    pass: testAccount.pass,
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
  };
}
