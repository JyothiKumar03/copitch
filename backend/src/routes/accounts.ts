import { Router } from "express";
import { create_project, import_project, list_projects, register_account, sign_in, sign_out } from "../controllers/accounts";

export const accounts = Router();
accounts.post("/account/register", register_account);
accounts.post("/account/login", sign_in);
accounts.post("/account/logout", sign_out);
accounts.get("/projects", list_projects);
accounts.post("/projects", create_project);
accounts.post("/projects/import", import_project);
