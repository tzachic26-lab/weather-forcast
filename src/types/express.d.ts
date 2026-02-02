export {};

declare global {
  namespace Express {
    interface User {
      id?: string;
      displayName?: string;
      email?: string | null;
      photo?: string | null;
    }

    interface Request {
      user?: User;
      session?: { destroy: (callback: () => void) => void };
      logout?: (callback: (error?: Error) => void) => void;
    }
  }
}
