// POST /speca/projects — make a project (chats on a topic, a code folder, a cloned GitHub repository) and open its first chat.
import { route } from "../../web/route.ts";
import { createProject } from "../../web/projectNew.ts";

export default route(async (c) => createProject(c));
