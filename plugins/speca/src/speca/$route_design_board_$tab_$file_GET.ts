// GET /speca/design/board/:tab/:file — one artboard for the editor, in a sandboxed frame (?ver= / ?at=: as it was).
import { route } from "../../web/route.ts";
import { boardPage } from "../../web/design/routes.ts";

export default route(boardPage);
