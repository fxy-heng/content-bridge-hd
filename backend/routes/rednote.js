import { Router } from "express";
import {
  checkLoginStatus,
  diagnoseApiPublishReadiness,
  diagnosePublishPageControls,
  openLoginPage,
  publishNote
} from "../services/rednote-browser.js";

const router = Router();

router.post("/login", async (req, res, next) => {
  try {
    res.json(await openLoginPage());
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

router.get("/status", async (req, res, next) => {
  try {
    const status = await checkLoginStatus();
    res.json({
      platform: "rednote",
      connected: status.loggedIn,
      ...status
    });
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

router.get("/diagnose", async (req, res, next) => {
  try {
    res.json(await diagnoseApiPublishReadiness());
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

router.get("/diagnose-controls", async (req, res, next) => {
  try {
    res.json(await diagnosePublishPageControls());
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

router.post("/publish", async (req, res, next) => {
  const { title = "", body = "", tags = [], coverUrl = "", dryRun = false } = req.body || {};

  if (!title.trim() || !body.trim()) {
    res.status(400).json({
      status: "failed",
      platform: "rednote",
      code: "EMPTY_CONTENT",
      reason: "Title and body are required."
    });
    return;
  }

  try {
    const result = await publishNote({ title, body, tags, coverUrl, dryRun });
    const status = result.status === "login_required" ? 409 : 200;
    res.status(status).json(result);
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

export default router;
