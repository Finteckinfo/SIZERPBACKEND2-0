import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import csrf from "csurf";

export const securityMiddleware = [
  helmet(),
  csrf({ cookie: true })
];
