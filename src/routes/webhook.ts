// src/routes/webhook.ts
import express, { Router, Request, Response } from "express";
import { Webhook } from "svix";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();

const router = Router();
const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

if (!webhookSecret) {
  throw new Error("[Webhook] Missing CLERK_WEBHOOK_SECRET in environment variables");
}

// Raw body middleware for Svix
router.post(
  "/clerk",
  bodyParser.raw({ type: "*/*" }),
  async (req: Request, res: Response) => {
    const payload = req.body.toString("utf8");
    const headers = req.headers;

    const svixId = headers["svix-id"] as string;
    const svixTimestamp = headers["svix-timestamp"] as string;
    const svixSignature = headers["svix-signature"] as string;

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.error("[Webhook] Missing Svix headers");
      return res.status(400).json({ error: "Missing Svix headers" });
    }

    const wh = new Webhook(webhookSecret);

    let evt: any;
    try {
      evt = wh.verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (err) {
      console.error("[Webhook] Verification failed:", err);
      return res.status(400).json({ error: "Invalid signature" });
    }

    console.log(`[Webhook] Received event: ${evt.type}`);

    try {
      if (evt.type === "user.created") {
        const { id, email_addresses, first_name, last_name } = evt.data;
        console.log("[DB] Insert user:", {
          id,
          email: email_addresses[0]?.email_address,
          name: `${first_name ?? ""} ${last_name ?? ""}`.trim(),
        });
        // TODO: Insert into DB here
      }

      if (evt.type === "user.deleted") {
        console.log("[DB] Delete user:", evt.data.id);
        // TODO: Delete from DB here
      }
    } catch (dbError) {
      console.error("[Webhook] Database error:", dbError);
      return res.status(500).json({ error: "Database error" });
    }

    return res.status(200).json({ success: true });
  }
);

export default router;
