import type { User as DbUser } from "@shared/models/auth";

declare global {
  namespace Express {
    interface User extends DbUser {}
  }
}

export {};
