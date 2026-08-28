declare global {
  namespace App {
    interface Locals {
      ownerId: string | null;
      sessionId: string | null;
      username: string | null;
    }
  }
}

export {};
