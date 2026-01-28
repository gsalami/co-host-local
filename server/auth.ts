import type { Express, RequestHandler } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import createMemoryStore from "memorystore";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function createRateLimiter({ windowMs, max, keyPrefix }: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt <= now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }

    entry.count += 1;
    rateLimitStore.set(key, entry);
    return next();
  };
}

// Simple session configuration using memory store
const MemoryStoreClass = createMemoryStore(session);
export const sessionStore = new MemoryStoreClass({
  checkPeriod: 86400000, // prune expired entries every 24h
});

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax" as const,
      maxAge: sessionTtl,
    },
  });
}

// Setup local username/password authentication
export function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyPrefix: "login",
  });
  const authLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    keyPrefix: "auth",
  });

  // Configure passport local strategy
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        // Check against environment variables
        const authUser = process.env.AUTH_USER;
        const authPassword = process.env.AUTH_PASSWORD;

        if (!authUser || !authPassword) {
          return done(null, false, { message: "Authentication not configured" });
        }

        if (username === authUser && password === authPassword) {
          // Find or create user in database
          let user = await db.query.users.findFirst({
            where: eq(users.email, username),
          });

          if (!user) {
            // Create user if doesn't exist
            const [newUser] = await db
              .insert(users)
              .values({
                email: username,
                firstName: "Admin",
                lastName: "User",
              })
              .returning();
            user = newUser;
          }

          return done(null, user);
        }

        return done(null, false, { message: "Invalid username or password" });
      } catch (error) {
        return done(error);
      }
    })
  );

  passport.serializeUser((user: unknown, done) => {
    const userId = typeof (user as { id?: string }).id === "string" ? (user as { id: string }).id : null;
    done(null, userId);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
      });
      done(null, user || null);
    } catch (error) {
      done(error);
    }
  });

  // Login route
  app.post("/api/login", loginLimiter, passport.authenticate("local"), (req, res) => {
    res.json({ success: true, user: req.user });
  });

  // Logout route
  app.post("/api/logout", authLimiter, (req, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });

  // Get current user
  app.get("/api/auth/user", authLimiter, (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Unauthorized" });
    }
  });
}

// Authentication middleware
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};
