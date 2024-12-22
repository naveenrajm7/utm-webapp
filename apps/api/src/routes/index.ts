import { Router } from "express";
import { listVMs } from "../controllers/listVmsController";

const router = Router();

router.get("/list_vms", listVMs);

export default router;