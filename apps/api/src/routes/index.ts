import { Router } from "express";
import { listVMs } from "../controllers/listVmsController";
import { getVmInfo } from "../controllers/getVmInfoController";
import { startVm } from "../controllers/startVmController";
import { stopVm } from "../controllers/stopVmController";
import { statusVm } from "../controllers/statusVmController";

const router = Router();

router.get("/list_vms", listVMs);
router.get("/vm_info", getVmInfo);
router.post("/start", startVm);
router.post("/stop", stopVm);
// `status` seems to be a reserved route somewhere (express or websocket?)
router.get("/status_vm", statusVm);

export default router;