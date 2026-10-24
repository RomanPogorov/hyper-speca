// POST /speca/uploads — a file for the message being written; returns its chip for the composer.
import { route } from "../../web/route.ts";
import { upload } from "../../web/uploads.ts";

export default route(upload);
