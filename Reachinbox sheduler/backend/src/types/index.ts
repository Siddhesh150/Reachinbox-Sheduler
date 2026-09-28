export interface AuthedUser {
  id: number;
  googleId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Sender {
  id: number;
  ownerId: number;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export interface EmailRow {
  id: number;
  campaignId: number;
  senderId: number;
  ownerId: number;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  sentAt: string | null;
  status: "scheduled" | "sent" | "failed";
  error: string | null;
  jobId: string | null;
}

export interface EmailJobData {
  emailId: number;
  senderId: number;
  recipient: string;
  subject: string;
  body: string;
  hourlyLimit: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}
