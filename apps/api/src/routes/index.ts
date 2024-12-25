import { Router } from "express";
import { listVMs } from "../controllers/listVmsController";
import { getVmInfo } from "../controllers/getVmInfoController";

const router = Router();

router.get("/list_vms", listVMs);
router.get("/vm_info", getVmInfo);

export default router;