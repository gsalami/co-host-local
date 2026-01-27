import type { Express, RequestHandler } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import createMemoryStore from "memorystore";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

// Simple session configuration using memory store
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const MemoryStore = createMemoryStore(session);

  return session({
    secret: process.env.SESSION_SECRET!,
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
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
  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.json({ success: true, user: req.user });
  });

  // Logout route
  app.post("/api/logout", (req, res) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });

  // Get current user
  app.get("/api/auth/user", (req, res) => {
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
