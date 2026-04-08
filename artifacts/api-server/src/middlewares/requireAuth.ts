import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
};
